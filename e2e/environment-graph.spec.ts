import { expect, test, type Locator, type Page } from "@playwright/test"
import seed from "../src/data/seed.json" with { type: "json" }
import type { Environment, PlatformState } from "../src/types/platform"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { terminalInstallers } from "../src/lib/terminal-installers"
import { overviewSteps } from "../src/lib/instructions-tour"

for (const newline of ["\n", "\r\n", "\r"]) test(`shared file browser uploads chunks, edits, downloads and respects read-only and disconnect (${JSON.stringify(newline)} line endings)`, async ({ page }) => {
  const html = (await readFile(resolve("src-tauri/src/runtime/connection_files.html"), "utf8")).replace(/\r\n?|\n/g, newline)
  const script = html.replace(/\r\n?/g, "\n").split("<script>")[1].split("</script>")[0]
  const hash = createHash("sha256").update(script).digest("base64")
  const files = new Map<string, Buffer>([["project.txt", Buffer.from("before")]])
  let writable = true, active = true, writes = 0
  await page.route("http://10.192.0.1:7444/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/") return route.fulfill({ contentType: "text/html", body: html, headers: { "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } })
    if (path === "/connections") return route.fulfill({ json: active ? [{ id: "conn-browser", label: "Container ↔ Windows", writable }] : [] })
    const body = request.postDataJSON()
    expect(request.headers()["x-opendock-files"]).toBe("1")
    expect(body.connectionId).toBe("conn-browser")
    if (!active || !writable && !["list", "stat", "read"].includes(body.operation)) return route.fulfill({ status: 403, json: { error: "Access revoked or read-only" } })
    switch (body.operation) {
      case "list": return route.fulfill({ json: { entries: [...files].map(([name, bytes]) => ({ name, size: bytes.length, directory: false })) } })
      case "create":
        if (files.has(body.path)) return route.fulfill({ status: 409, json: { error: "Already exists" } })
        files.set(body.path, Buffer.alloc(0)); break
      case "read": return route.fulfill({ json: { data: files.get(body.path)!.subarray(body.offset, body.offset + body.length).toString("base64") } })
      case "write": {
        writes++
        const bytes = Buffer.from(body.data, "base64"), old = files.get(body.path)!, next = Buffer.alloc(Math.max(old.length, body.offset + bytes.length))
        old.copy(next); bytes.copy(next, body.offset); files.set(body.path, next); break
      }
      case "truncate": files.set(body.path, files.get(body.path)!.subarray(0, body.length)); break
      case "remove": files.delete(body.path); break
      default: throw Error(`Unexpected file operation: ${body.operation}`)
    }
    await route.fulfill({ json: {} })
  })
  await page.goto("http://10.192.0.1:7444/")
  const row = page.getByRole("row").filter({ hasText: "project.txt" })
  await row.getByRole("button", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "File contents" })).toHaveValue("before")
  await page.getByRole("textbox", { name: "File contents" }).fill("edited ✓")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect.poll(() => files.get("project.txt")!.toString()).toBe("edited ✓")
  const payload = Buffer.alloc(300_000, 65)
  await page.locator("#pick").setInputFiles({ name: "data.bin", mimeType: "application/octet-stream", buffer: payload })
  await expect(page.getByRole("row").filter({ hasText: "data.bin" })).toBeVisible()
  expect(files.get("data.bin")).toEqual(payload)
  expect(writes).toBeGreaterThanOrEqual(4)
  const downloading = page.waitForEvent("download")
  await row.getByRole("button", { name: "Download", exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("project.txt")
  expect(await readFile((await download.path())!, "utf8")).toBe("edited ✓")
  writable = false
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("button", { name: "Upload files" })).toBeDisabled()
  await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeDisabled()
  active = false
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("No active shared folders")
  await expect(page.locator("#entries tr")).toHaveCount(0)
})

test("VM and MicroVM nodes have working private connection handles", async ({ page }) => {
  await openGraph(page, [fixture("Micro", "microVm"), fixture("VM", "fullVm"), fixture("Container")])
  for (const name of ["Micro", "VM", "Container"]) {
    await expect(page.locator(`[aria-label="Connect ${name} to another environment"]`)).toBeVisible()
    await expect(page.locator(`[aria-label="Connect another environment to ${name}"]`)).toBeVisible()
  }
  const from = await center(page.locator('[aria-label="Connect Micro to another environment"]'))
  const to = await center(page.locator('[aria-label="Connect another environment to VM"]'))
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 15 }); await page.mouse.up()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("combobox", { name: "From", exact: true })).toContainText("Micro")
  await expect(dialog.getByRole("combobox", { name: "To", exact: true })).toContainText("VM")
  await expect(dialog.getByRole("checkbox")).toHaveCount(5)
  await portsOnly(dialog)
  await dialog.getByRole("textbox", { name: /Allowed TCP ports/ }).fill("22, 3000")
  await dialog.getByRole("button", { name: "Create connection", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const connections = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).connections)
  expect(connections).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "Micro", targetId: "VM", permissions: ["ports"], ports: ["22", "3000"] })]))
  await page.getByRole("button", { name: "Configure Micro", exact: true }).click()
  await page.getByRole("button", { name: "Disconnect from VM", exact: true }).click()
  await expect(page.getByRole("button", { name: "Reconnect to VM", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Reconnect to VM", exact: true }).click()
  await expect(page.getByRole("button", { name: "Disconnect from VM", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remove connection with VM", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove connection with VM", exact: true })).toHaveCount(0)
})

test("cloud environment button adds a verified server node with Connect, not Start", async ({ page }) => {
  test.setTimeout(90000)
  await openGraph(page)
  const toolbar = page.getByRole("group", { name: "Dashboard actions", exact: true })
  const cloudButton = toolbar.getByRole("button", { name: "Cloud environment", exact: true })
  const createButton = toolbar.getByRole("button", { name: "New environment", exact: true })
  expect((await cloudButton.boundingBox())!.x).toBeLessThan((await createButton.boundingBox())!.x)
  await cloudButton.click()
  const dialog = page.getByRole("dialog", { name: "Cloud environment", exact: true })
  await dialog.getByRole("textbox", { name: "Node name" }).fill("Cloud database")
  await dialog.getByRole("textbox", { name: "Server address" }).fill("server.example.com")
  await dialog.getByRole("textbox", { name: "SSH identity file" }).fill("C:/Keys/cloud.pem")
  const add = dialog.getByRole("button", { name: "Add cloud node" })
  await expect(add).toBeDisabled()
  await dialog.getByRole("button", { name: "Check identity" }).click()
  await dialog.getByRole("radio").check()
  await expect(add).toBeEnabled()
  await dialog.getByRole("textbox", { name: "Server address" }).fill("other.example.com")
  await expect(add).toBeDisabled()
  await expect(dialog.getByRole("radio")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Check identity" }).click()
  await dialog.getByRole("radio").check()
  await add.click()
  await expect(dialog).not.toBeVisible()
  const node = page.locator('[data-environment-id]').filter({ has: page.getByText("Cloud database", { exact: true }) })
  await expect(node.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
  await expect(node.getByRole("button", { name: "Start", exact: true })).toHaveCount(0)
  await expect(node.locator('[data-environment-connection-point]')).toHaveCount(0)
  await expect(node.locator('.react-flow__handle')).toHaveCount(2)
  await page.evaluate(async () => { const { platformApi } = await import("/src/api/platform-api.ts"); platformApi.openEnvironmentWindow = async () => true })
  await node.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(node.getByText("Connected", { exact: true })).toBeVisible()
  await expect(node.getByRole("button", { name: "Open", exact: true })).toBeVisible()
  await expect(node.getByRole("button", { name: /Pause|Shut down/ })).toHaveCount(0)
  await node.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(node.getByText("Disconnected", { exact: true })).toBeVisible()
  await expect(node.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
})

for (const localKind of ["container", "microVm", "fullVm"] as const) {
  test(`cloud node connects files and TCP ports to ${localKind} without publishing controls`, async ({ page }) => {
    await openGraph(page, [{ ...fixture("Cloud", "cloud"), provider: "cloudSsh" }, fixture("Local", localKind)])
    await page.getByRole("button", { name: "Connect Cloud", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
    await dialog.getByRole("checkbox", { name: "Ports", exact: true }).check()
    await dialog.getByRole("textbox", { name: /TCP ports/i }).fill("5432")
    await dialog.getByRole("button", { name: "Create connection", exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).connections.find((c: { sourceId: string }) => c.sourceId === "Cloud"))
    expect(saved).toMatchObject({ sourceId: "Cloud", targetId: "Local", permissions: ["files", "ports"], ports: ["5432"], direction: "bidirectional" })
    const cloud = page.locator('[data-environment-id="Cloud"]')
    await expect(cloud.getByRole("button", { name: /Add service|capabilities/ })).toHaveCount(0)
    await cloud.getByRole("button", { name: "Configure Cloud" }).click()
    const sheet = page.getByRole("dialog", { name: "Cloud", exact: true })
    await expect(sheet.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
    await expect(sheet.getByText("Local network and Public access are blocked.", { exact: false })).toBeVisible()
    await expect(sheet.getByRole("button", { name: /Factory reset|Save policy|Start|Stop/ })).toHaveCount(0)
  })
}

for (const kind of ["container", "microVm", "fullVm"] as const) test(`connection Skills can be read and copied from a ${kind} window`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const environment = fixture("env-skills-source", kind)
  environment.status = "running"
  const peer = fixture("skills-peer", kind); peer.status = "running"
  const state = structuredClone(seed) as PlatformState; state.environments = [environment, peer]
  state.connections = [{ id: "conn-skills", sourceId: environment.id, targetId: peer.id, direction: "bidirectional", permissions: ["files"], ports: [], active: true, createdAt: "test", enforcementStatus: "enforced" }]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.addInitScript(({ id, mounted }) => localStorage.setItem("opendock.workspace.v1", JSON.stringify({ [id]: {
    services: [], publications: [], notice: "", shares: [
      { id: "share-input", environmentId: id, path: "C:\\Shared input", readOnly: true, mountPath: mounted ? "/opendock/shared/my-pc/share-input" : null, guestUrl: "http://10.0.2.2:54321/private-input-token/" },
      { id: "share-project", environmentId: id, path: "C:\\Shared project", readOnly: !mounted, mountPath: mounted ? "/opendock/shared/my-pc/share-project" : null, guestUrl: "http://10.0.2.2:54322/private-project-token/" },
      { id: "share-other", environmentId: "env-other", path: "C:\\Not shared here", readOnly: false, mountPath: "/other", guestUrl: "http://10.0.2.2:54323/private-other-token/" },
    ],
  } })), { id: environment.id, mounted: kind !== "fullVm" })
  await page.goto("/?environment=env-skills-source")
  await expect(page.getByRole("button", { name: "Connection skills", exact: true })).toBeVisible({ timeout: 20000 })
  await page.getByRole("button", { name: "Connection skills", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Connection skills", exact: true })
  await expect(dialog.getByRole("textbox", { name: "AI agent connection instructions" })).toHaveValue(/Yougori connection skill/)
  await expect(dialog.getByRole("list", { name: "Connected nodes" })).toContainText("skills-peer")
  await expect(dialog.getByRole("list", { name: "Connected nodes" })).toContainText("Connection ready")
  // Backend changes after opening: Copy must fetch again, not copy the old ready state.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("opendock.platform.v1")!)
    state.environments.find((e: { id: string }) => e.id === "skills-peer").status = "stopped"
    localStorage.setItem("opendock.platform.v1", JSON.stringify(state))
  })
  await dialog.getByRole("button", { name: "Copy skills", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")
  expect(copied).toContain("Copying this skill does not grant access")
  expect(copied).toContain("PEER_STOPPED")
  await expect(dialog.getByRole("list", { name: "Connected nodes" })).toContainText("turned off")
  const pc = JSON.parse(copied.split("```json\n")[1]!.split("\n```")[0]!).myPc
  expect(pc.connected).toBe(true)
  expect(pc.folders).toHaveLength(2)
  expect(pc.folders[0]).toMatchObject({ shareId: "share-input", hostPath: "C:\\Shared input", readOnly: true, writable: false, usableNow: true })
  expect(pc.folders[1]).toMatchObject({ shareId: "share-project", writable: kind !== "fullVm", privateLinkRequired: kind === "fullVm" })
  expect(copied).not.toContain("private-input-token")
  expect(copied).not.toContain("private-project-token")
  expect(copied).not.toContain("Not shared here")
  if (kind === "container") {
    await page.evaluate(async () => {
      const module = "/src/api/platform-api.ts", { platformApi } = await import(module)
      const original = platformApi.connectionSkills
      Object.assign(window, { restoreSkills: () => { platformApi.connectionSkills = original } })
      platformApi.connectionSkills = async () => { throw new Error("Fixture: connection state unavailable") }
    })
    await dialog.getByRole("button", { name: /^(Copy skills|Copied)$/ }).click()
    await expect(dialog.getByRole("alert")).toContainText("No cached instructions were copied")
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(copied)
    await page.evaluate(() => (window as unknown as { restoreSkills(): void }).restoreSkills())
    await dialog.getByRole("button", { name: "Refresh skills" }).click()
    await expect(dialog.getByRole("alert")).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Copy skills", exact: true })).toBeEnabled()
  }
  await page.keyboard.press("Escape")
  await page.evaluate(async () => {
    const module = "/src/api/workspace-api.ts", { workspaceApi } = await import(module)
    await workspaceApi.unshare("share-input")
    await workspaceApi.unshare("share-project")
  })
  await page.getByRole("button", { name: "Connection skills", exact: true }).click()
  await expect(dialog.getByRole("textbox", { name: "AI agent connection instructions" })).toHaveValue(/"connected": false/)
  await expect(dialog.getByRole("textbox", { name: "AI agent connection instructions" })).not.toHaveValue(/Shared input|Shared project/)
})

for (const kind of ["container", "microVm", "fullVm"] as const) test(`Skills is hidden without node links but shows disabled/offline peers in a ${kind}`, async ({ page }) => {
  const a = fixture("env-skills-A", kind), b = fixture("env-skills-B", "fullVm"), c = fixture("env-skills-C", "container"), d = fixture("env-skills-D", "microVm")
  a.status = "running"; c.status = "paused"
  const state = structuredClone(seed) as PlatformState; state.environments = [a, b, c, d]; state.connections = []
  await page.addInitScript(state => { if (!localStorage.getItem("opendock.platform.v1")) localStorage.setItem("opendock.platform.v1", JSON.stringify(state)) }, state)
  await page.addInitScript(() => localStorage.setItem("opendock.workspace.v1", JSON.stringify({ "env-skills-A": { services: [], publications: [], notice: "", shares: [{ id: "only-pc", environmentId: "env-skills-A", path: "C:\\Chosen", readOnly: true, mountPath: "/my-pc", guestUrl: "private-token" }] } })))
  await page.goto("/?environment=env-skills-A")
  await expect(page.getByRole("combobox", { name: "Switch environment" })).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole("button", { name: "Connection skills", exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("opendock.platform.v1")!)
    state.connections = [
      { id: "AB", sourceId: "env-skills-A", targetId: "env-skills-B", direction: "bidirectional", permissions: ["files"], ports: [], active: true, createdAt: "test", enforcementStatus: "pending" },
      { id: "CA", sourceId: "env-skills-C", targetId: "env-skills-A", direction: "oneWay", permissions: ["ports"], ports: ["3000"], active: false, createdAt: "test", enforcementStatus: "enforced" },
      { id: "BD", sourceId: "env-skills-B", targetId: "env-skills-D", direction: "bidirectional", permissions: ["files"], ports: [], active: true, createdAt: "test", enforcementStatus: "enforced" },
    ]
    localStorage.setItem("opendock.platform.v1", JSON.stringify(state))
  })
  await page.reload()
  await page.getByRole("button", { name: "Connection skills", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Connection skills", exact: true }), list = dialog.getByRole("list", { name: "Connected nodes" })
  await expect(list).toContainText("env-skills-B")
  await expect(list).toContainText("env-skills-C")
  await expect(list).not.toContainText("env-skills-D")
  await expect(list).toContainText("turned off")
  await expect(list).toContainText("paused")
  await expect(list).toContainText("switched off")
  await page.keyboard.press("Escape")
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("opendock.platform.v1")!); state.connections = []
    localStorage.setItem("opendock.platform.v1", JSON.stringify(state))
  })
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Switch environment" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Connection skills", exact: true })).toHaveCount(0)
})

function fixture(id: string, kind: Environment["kind"] = "container"): Environment {
  return {
    id, name: id, kind, provider: kind === "container" ? "openDockOci" : "qemu", status: "stopped",
    runtime: kind === "container" ? "alpine:latest" : "builtin:alpine", description: "", createdAt: "2026-01-01T00:00:00Z",
    networkAccess: false, gpuAccess: false, cpuUsage: 0, memoryUsageGb: 0, storageDeltaGb: 0, networkRxMbps: 0,
    resourcePolicy: { cpu: { min: 0.1, preferred: 0.25, max: 0.5, current: 0 }, memoryGb: { min: 0.125, preferred: 0.25, max: 0.5, current: 0 }, priority: "normal", dynamic: false },
  }
}

async function portsOnly(dialog: Locator) {
  await dialog.getByRole("checkbox", { name: "Files", exact: true }).uncheck()
  await dialog.getByRole("checkbox", { name: "Ports", exact: true }).check()
}

for (const source of ["container", "microVm", "fullVm"] as const) for (const target of ["container", "microVm", "fullVm"] as const) {
  test(`shared files can be connected by default from ${source} to ${target}`, async ({ page }) => {
    await openGraph(page, [fixture("Source", source), fixture("Target", target)])
    await page.getByRole("button", { name: "Connect Source", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
    await expect(dialog.getByRole("checkbox", { name: "Files", exact: true })).toBeChecked()
    await expect(dialog.locator('input[type="radio"][value="bidirectional"]')).toBeChecked()
    await dialog.getByRole("button", { name: "Create connection", exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).connections.find((c: { sourceId: string }) => c.sourceId === "Source"))
    expect(saved).toMatchObject({ sourceId: "Source", targetId: "Target", direction: "bidirectional", permissions: ["files"], ports: [] })
  })
}

async function openGraph(page: Page, environments = [fixture("Alpha"), fixture("Beta")]) {
  const state = structuredClone(seed) as PlatformState
  state.host.totalCpu = 8
  state.host.totalMemoryGb = 16
  state.host.totalStorageGb = 1024
  state.host.usedStorageGb = 128
  state.environments = environments
  const seedKey = `opendock.test.seed.${Date.now()}.${Math.random()}`
  await page.addInitScript(({ state, seedKey }) => {
    if (!sessionStorage.getItem(seedKey)) {
      localStorage.setItem("opendock.platform.v1", JSON.stringify(state))
      sessionStorage.setItem(seedKey, "1")
    }
  }, { state, seedKey })
  // The first dev-server visit compiles the lazy graph and its UI modules.
  // Keep that cold-start budget separate from normal locator/action waits.
  test.setTimeout(Math.max(test.info().timeout, 60_000))
  await page.goto("/")
  await expect(page.locator("[data-environment-connection-point]")).toHaveCount(environments.filter(e => e.kind !== "cloud").length, { timeout: 45_000 })
  await page.getByRole("button", { name: "Fit environments", exact: true }).click()
}

async function seedServices(page: Page, id = "Alpha") {
  await page.addInitScript(id => localStorage.setItem("opendock.workspace.v1", JSON.stringify({ [id]: { services: [{ port: 4200, protocol: "tcp", name: "Dev server", address: "127.0.0.1" }, { port: 8080, protocol: "tcp", name: "Web server", address: "0.0.0.0" }], publications: [], shares: [], notice: "" } })), id)
}

const port = (page: Page, id = "Alpha") => page.locator(`[data-environment-connection-point="${id}"]`)
const dockPort = (page: Page, capability: string) => page.locator(`[data-capability-connection-point="${capability}"]`)
const line = (page: Page, capability: string, id = "Alpha") => page.locator(`[data-capability-line="${capability}:${id}"]`)

async function center(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error("Missing connector")
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function assertRoundedPath(path: Locator) {
  const d = (await path.getAttribute("d"))!
  expect(d).toMatch(/^M/)
  expect(d).toContain("C")
  expect(d).not.toMatch(/NaN|Infinity/)
}

async function drag(page: Page, from: Locator, to: Locator, offset = { x: 0, y: 0 }) {
  // Wait for closing dialogs to release pointer events before starting a real gesture.
  await from.hover()
  const start = await center(from)
  const end = await center(to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x + offset.x, end.y + offset.y, { steps: 12 })
  await expect(page.locator("[data-connection-preview]")).toBeAttached()
  await assertRoundedPath(page.locator("[data-connection-preview]"))
  await page.mouse.up()
}

async function assertLineAligned(page: Page, capability: string, id = "Alpha") {
  await expect(line(page, capability, id)).toBeAttached()
  await assertRoundedPath(line(page, capability, id))
  await expect.poll(() => page.evaluate(({ capability, id }) => {
    const path = document.querySelector<SVGPathElement>(`[data-capability-line="${capability}:${id}"]`)
    const source = document.querySelector(`[data-capability-connection-point="${capability}"]`)
    const target = document.querySelector(`[data-environment-connection-point="${id}"]`)
    const svg = document.querySelector("[data-capability-lines]")
    if (!path || !source || !target || !svg) return false
    const bounds = svg.getBoundingClientRect(), a = source.getBoundingClientRect(), b = target.getBoundingClientRect()
    const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength())
    return Math.abs(start.x + bounds.left - a.left - a.width / 2) < 0.5
      && Math.abs(start.y + bounds.top - a.top - a.height / 2) < 0.5
      && Math.abs(end.x + bounds.left - b.left - b.width / 2) < 0.5
      && Math.abs(end.y + bounds.top - b.top - b.height / 2) < 0.5
  }, { capability, id })).toBe(true)
}

test("drags from either endpoint, previews, snaps, saves and detaches", async ({ page }) => {
  await openGraph(page)
  await drag(page, dockPort(page, "internet"), port(page), { x: 15, y: 9 })
  await assertLineAligned(page, "internet")
  await expect(page.locator("[data-connection-preview]")).toHaveCount(0)
  await expect(page.locator("[data-environment-graph]")).toHaveAttribute("data-connecting", "false")
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Detach Internet access from Alpha", exact: true }).click()
  await drag(page, port(page), dockPort(page, "internet"))
  await assertLineAligned(page, "internet")
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0])
  expect(saved.networkAccess).toBe(true)
  expect(saved.resourcePolicy.dynamic).toBe(true)
  await page.getByRole("button", { name: "Detach Internet access from Alpha", exact: true }).click()
  await expect(line(page, "internet")).toHaveCount(0)
  await expect(page.locator('[data-capability-kind="gpu"]')).toHaveCount(0)
})

test("graph uses the available width and a taller responsive canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openGraph(page)
  const graph = (await page.locator("[data-environment-graph]").boundingBox())!
  const canvas = (await page.locator("[data-environment-canvas]").boundingBox())!
  expect(graph.width).toBeGreaterThan(1800)
  // The redesigned workspace fills the space left by its toolbar and docks,
  // rather than imposing the old fixed 640px minimum and scrolling the page.
  expect(canvas.height).toBeGreaterThan(1080 / 2)
  expect(graph.y + graph.height).toBeLessThanOrEqual(1080)
  await page.setViewportSize({ width: 1920, height: 880 })
  await expect.poll(async () => (await page.locator("[data-environment-canvas]").boundingBox())!.height).toBeCloseTo(canvas.height - 200, 0)
})

for (const kind of ["container", "fullVm"] as const) {
  test(`plugs and unplugs internet on a running ${kind} without stopping it`, async ({ page }) => {
    const env = fixture("Alpha", kind)
    env.status = "running"
    await openGraph(page, [env])
    await drag(page, dockPort(page, "internet"), port(page))
    await assertLineAligned(page, "internet")
    await page.getByRole("button", { name: "Detach Internet access from Alpha", exact: true }).click()
    await expect(line(page, "internet")).toHaveCount(0)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0])
    expect(saved.status).toBe("running")
    expect(saved.networkAccess).toBe(false)
    await drag(page, dockPort(page, "internet"), port(page))
    await assertLineAligned(page, "internet")
    await page.reload()
    await assertLineAligned(page, "internet")
  })
}

test("capability labels stay in one compact row and fixed controls surround the canvas", async ({ page }) => {
  const env = fixture("Alpha"); env.networkAccess = true; env.gpuAccess = true; env.resourcePolicy.dynamic = true
  await openGraph(page, [env])
  const labels = page.getByLabel("Attached capabilities")
  await expect(page.locator('[data-capability-card="dynamic"]')).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Detach Dynamic allocation/ })).toHaveCount(0)
  const layout = await labels.evaluate(element => {
    const boxes = [...element.children].map(child => child.getBoundingClientRect())
    return { sameRow: boxes.every(box => Math.abs(box.top - boxes[0].top) < 1), height: element.getBoundingClientRect().height }
  })
  expect(layout.sameRow).toBe(true); expect(layout.height).toBeLessThanOrEqual(21)
  const canvas = (await page.locator("[data-environment-canvas]").boundingBox())!
  const dock = page.getByRole("region", { name: "Environment capabilities", exact: true })
  const pc = (await dock.getByRole("button", { name: "My PC", exact: true }).boundingBox())!
  expect(pc.y).toBeGreaterThanOrEqual(canvas.y + canvas.height)
  for (const name of ["Internet access"]) {
    const box = (await dock.getByRole("button", { name, exact: true }).boundingBox())!
    expect(Math.abs(box.y - pc.y)).toBeLessThan(1)
    expect(pc.x + pc.width).toBeLessThan(box.x)
  }
  await expect(dockPort(page, "pc")).toHaveAttribute("data-connection-side", "top")
  await expect(page.getByRole("complementary", { name: "PC folder access" })).toHaveCount(0)
  const local = (await page.locator('[data-publication-card="local"]').boundingBox())!
  const publicAccess = (await page.locator('[data-publication-card="public"]').boundingBox())!
  expect(local.x + local.width).toBeLessThan(publicAccess.x)
  expect(Math.abs(local.y - publicAccess.y)).toBeLessThan(1)
  expect(local.y + local.height).toBeLessThan(canvas.y)
  await expect(page.locator('[data-publication-connection-point="local"]')).toHaveAttribute("data-connection-side", "bottom")
  await expect(page.locator('[data-publication-card]')).toHaveCount(2)
  await expect(page.getByRole("button", { name: "Public access / Cloudflare Tunnel", exact: true })).toBeVisible()
  await expect(page.locator('[data-publication-connection-point="cloudflare"]')).toHaveCount(0)
  expect((await page.locator('[data-publication-connection-point="public"]').boundingBox())!.y).toBeLessThan(canvas.y)
})

test("errored containers keep deletion failures visible and require explicit runtime recovery", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "error"; env.lastError = "The old runtime is locking serial.log"
  await openGraph(page, [env, fixture("Beta")])
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts"
    const { platformApi } = await import(url)
    const original = platformApi.deleteEnvironment
    platformApi.deleteEnvironment = async (id: string, recover = false) => {
      if (!recover) throw new Error("[OPENDOCK_RUNTIME_BUSY] Test orphan holds the container disk")
      await new Promise(resolve => window.addEventListener("complete-recovery", resolve, { once: true }))
      return original(id, recover)
    }
  })
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  await expect(page.getByLabel("Environment needs attention")).toContainText("locking serial.log")
  await page.getByRole("button", { name: "More environment actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete environment", exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('[data-environment-id="Alpha"]')).toBeAttached()
  await page.getByRole("button", { name: "More environment actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete environment", exact: true }).click()
  await dialog.getByRole("button", { name: "Delete environment", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Test orphan holds the container disk")
  await expect(page.locator('[data-environment-id="Alpha"]')).toBeAttached()
  await expect(dialog).toContainText("interrupts any containers")
  await dialog.getByRole("button", { name: "Recover runtime and delete", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("status").filter({ hasText: "Deleting environment" })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("complete-recovery")))
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('[data-environment-id="Alpha"]')).toHaveCount(0)
  await expect(page.locator('[data-environment-id="Beta"]')).toBeAttached()
})

test("normal deletion remains available from the environment menu", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  await page.getByRole("button", { name: "More environment actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete environment", exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByRole("heading", { name: "Delete Alpha?" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Recover runtime and delete", exact: true })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Delete environment", exact: true }).click()
  await expect(page.locator('[data-environment-id="Alpha"]')).toHaveCount(0)
  await expect(page.locator('[data-environment-id="Beta"]')).toBeAttached()
})

test("VM memory errors offer recovery and allocation actions instead of deletion", async ({ page }) => {
  const vm = fixture("Windows memory", "fullVm")
  vm.status = "error"
  vm.lastError = "Not enough memory to start this environment. It needs 27.00 GB but Windows can allocate only 15.50 GB."
  await openGraph(page, [vm])
  await page.getByRole("button", { name: "Configure Windows memory", exact: true }).click()
  const attention = page.getByLabel("Environment needs attention")
  await expect(attention.getByRole("button", { name: "Retry Start", exact: true })).toBeVisible()
  await expect(attention.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await expect(attention.getByRole("button", { name: "Delete environment", exact: true })).toHaveCount(0)
  await attention.getByRole("button", { name: "Adjust memory", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Resources", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("VM Stop remains available when stale state says stopped", async ({ page }) => {
  const vm = fixture("Leftover VM", "fullVm")
  await openGraph(page, [vm])
  await expect(page.getByRole("button", { name: "Shut down Leftover VM", exact: true })).toBeEnabled()
})

test("environment accents are distinct and match their capability lines", async ({ page }) => {
  const a = fixture("Alpha"), b = fixture("Beta")
  a.networkAccess = true; b.networkAccess = true
  await openGraph(page, [a, b])
  const alpha = await page.locator('[data-environment-id="Alpha"]').getAttribute("data-environment-color")
  const beta = await page.locator('[data-environment-id="Beta"]').getAttribute("data-environment-color")
  expect(alpha).toBeTruthy()
  expect(beta).toBeTruthy()
  expect(alpha).not.toBe(beta)
  await expect(page.locator('[data-capability-line="internet:Alpha"]')).toHaveAttribute("stroke", alpha!)
  await expect(page.locator('[data-capability-line="internet:Beta"]')).toHaveAttribute("stroke", beta!)
})

test("deletion updates runtime drive storage and explains incomplete cleanup", async ({ page }) => {
  await openGraph(page)
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts"
    const { platformApi } = await import(url)
    const remove = platformApi.deleteEnvironment
    platformApi.deleteEnvironment = async (id: string) => {
      const result = await remove(id)
      result.host.storageDrive = "C:\\"
      result.host.totalStorageGb = 100
      result.host.usedStorageGb = 80
      result.storageCleanup = { reclaimedCacheBytes: 0, warnings: ["Cached images were kept because a disk could not be inspected. Other environments are safe."] }
      return result
    }
  })
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  await page.getByRole("button", { name: "More environment actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete environment", exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText(/Only space actually used is reclaimed/)).toBeVisible()
  await dialog.getByRole("button", { name: "Delete environment", exact: true }).click()
  await expect(page.locator('[data-environment-id="Alpha"]')).toHaveCount(0)
  await expect(page.getByText("Environment removed — cleanup incomplete", { exact: true })).toBeVisible()
  await expect(page.getByText("Storage · C:", { exact: true })).toBeVisible()
  await expect(page.getByText("20.0 GB free", { exact: true })).toBeVisible()
  await expect(page.locator('[data-environment-id="Beta"]')).toBeAttached()
})

test("local backups choose a folder, show errors and confirm a verified save", async ({ page }) => {
  await openGraph(page)
  await page.evaluate(async () => {
    const url = "/src/api/local-backup-api.ts"
    const { localBackupApi } = await import(url)
    let attempts = 0
    localBackupApi.export = async (id: string, folder: string) => {
      if (id !== "Alpha" || folder !== "C:\\Backups") throw new Error("Wrong backup target")
      if (!attempts++) throw new Error("Destination is full")
      return "C:\\Backups\\Yougori-backup-test\\backup.opendock"
    }
  })
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  await page.getByRole("button", { name: "Back up to this PC", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Back up Alpha", exact: true })
  await expect(dialog).toContainText("not encrypted")
  await expect(dialog.getByRole("button", { name: "Create local backup", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Choose destination folder", exact: true }).click()
  await dialog.getByRole("button", { name: "Create local backup", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Destination is full")
  await dialog.getByRole("button", { name: "Create local backup", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("Backup saved and verified")
  await dialog.getByRole("button", { name: "Done", exact: true }).click()
})

test("local restore is available without nodes and retains failures for retry", async ({ page }) => {
  await openGraph(page, [])
  const header = page.getByRole("banner")
  const backup = header.getByRole("button", { name: "Load local backup", exact: true })
  const create = header.getByRole("button", { name: "New environment", exact: true })
  await expect(backup).toBeVisible()
  await expect(page.getByRole("heading", { name: "Environments", exact: true })).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("button", { name: "Load local backup", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Create environment", exact: true })).toHaveCount(0)
  const backupBox = (await backup.boundingBox())!
  const createBox = (await create.boundingBox())!
  expect(backupBox.x + backupBox.width).toBeLessThanOrEqual(createBox.x)
  await backup.click()
  const dialog = page.getByRole("dialog", { name: "Load a local backup", exact: true })
  await expect(dialog).toContainText("Existing nodes are not overwritten")
  await dialog.getByRole("button", { name: "Choose backup file", exact: true }).click()
  await dialog.getByRole("button", { name: "Restore as new environment", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("require the desktop app")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
})

test("running environments cannot start a local disk backup", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await openGraph(page, [env])
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  await page.getByRole("button", { name: "Back up to this PC", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Back up Alpha", exact: true })
  await expect(dialog.getByRole("alert")).toContainText("Stop this environment")
  await expect(dialog.getByRole("button", { name: "Choose destination folder", exact: true })).toBeDisabled()
})

test("configuration sidebar keeps compact stats, tabs and actions usable in narrow windows", async ({ page }) => {
  const env = fixture("Alpha"); env.name = "A long environment name for the production database and application workspace"
  env.runtime = "registry.example.test/" + "long-image-path/".repeat(20) + ":latest"
  await openGraph(page, [env])
  await page.getByRole("button", { name: `Configure ${env.name}`, exact: true }).click()
  const sheet = page.getByRole("dialog", { name: env.name, exact: true })
  await expect(sheet.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true")
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    expect((await sheet.boundingBox())!.width).toBe(640)
    expect((await sheet.locator('[data-slot="sheet-header"]').boundingBox())!.height).toBeLessThan(100)
    const metrics = await sheet.getByLabel("Environment usage").evaluate(element => {
      const boxes = [...element.children].map(child => child.getBoundingClientRect())
      return { oneRow: boxes.every(box => Math.abs(box.top - boxes[0].top) < 1), height: element.getBoundingClientRect().height }
    })
    expect(metrics.oneRow).toBe(true)
    expect(metrics.height).toBeLessThan(85)
  }
  for (const viewport of [{ width: 390, height: 650 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    for (const tab of ["Overview", "Resources", "Snapshots"]) {
      await sheet.getByRole("tab", { name: tab, exact: true }).click()
      const header = (await sheet.locator('[data-slot="sheet-header"]').boundingBox())!
      const tabs = (await sheet.getByRole("tablist").boundingBox())!
      await sheet.locator('[data-slot="scroll-area-viewport"]').first().evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect(sheet.getByRole("tab", { name: "Overview", exact: true })).toBeInViewport()
      await expect(sheet.getByRole("button", { name: "More environment actions", exact: true })).toBeInViewport()
      await expect(sheet.getByRole("button", { name: "Open", exact: true })).toBeInViewport()
      expect((await sheet.locator('[data-slot="sheet-header"]').boundingBox())!.y).toBe(header.y)
      expect((await sheet.getByRole("tablist").boundingBox())!.y).toBe(tabs.y)
      expect(await sheet.evaluate(element => {
        const box = element.getBoundingClientRect()
        const viewport = element.querySelector('[data-slot="scroll-area-viewport"]')!
        return box.left >= 0 && box.right <= innerWidth && viewport.scrollWidth <= viewport.clientWidth + 1
      })).toBe(true)
    }
  }
  await page.keyboard.press("Escape")
  await expect(sheet).not.toBeVisible()
})

test("configuration sidebar sliders preserve drafts between tabs and validate exact values", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Alpha", exact: true })
  await sheet.getByRole("tab", { name: "Resources", exact: true }).click()
  const saveChanges = sheet.getByRole("button", { name: "Save changes", exact: true })
  await expect(sheet.locator(".inspector-footer").getByRole("button", { name: "Save changes", exact: true })).toBeVisible()
  await expect(sheet.getByText("Changes apply when saved", { exact: true })).toHaveCount(0)
  const saveBox = await saveChanges.boundingBox()
  const openBox = await sheet.getByRole("button", { name: "Open", exact: true }).boundingBox()
  expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(openBox!.x)
  expect(Math.abs(saveBox!.y - openBox!.y)).toBeLessThan(2)
  await expect(sheet.getByRole("slider")).toHaveCount(7)
  await expect(sheet.getByRole("spinbutton")).toHaveCount(0)
  const cpu = sheet.getByRole("slider", { name: "CPU preferred", exact: true })
  await cpu.focus(); await page.keyboard.press("ArrowRight")
  await expect(cpu).toHaveValue("0.3")
  const memory = sheet.getByRole("slider", { name: "Memory preferred", exact: true })
  await memory.focus(); await page.keyboard.press("ArrowRight")
  await expect(memory).toHaveAttribute("aria-valuetext", "0.375 GB")
  await sheet.getByText("High", { exact: true }).click()
  const priority = await sheet.getByRole("radiogroup", { name: "Scheduling priority", exact: true }).evaluate(element => {
    const rows = [...element.querySelectorAll("label")].map(label => label.getBoundingClientRect())
    return rows.length === 4 && rows.every(row => Math.abs(row.top - rows[0].top) < 1)
  })
  expect(priority).toBe(true)
  await sheet.getByRole("tab", { name: "Overview", exact: true }).click()
  await sheet.getByRole("tab", { name: "Resources", exact: true }).click()
  await expect(cpu).toHaveValue("0.3")
  await expect(memory).toHaveValue("0.375")
  await sheet.getByRole("button", { name: "Exact values", exact: true }).click()
  const preferred = sheet.getByRole("spinbutton", { name: "Preferred (GB)", exact: true })
  await preferred.fill("0")
  await expect(sheet.getByRole("alert")).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled()
  await preferred.fill("0.375")
  await expect(sheet.getByRole("alert")).toHaveCount(0)
  await sheet.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(sheet.getByRole("status").filter({ hasText: "Resource policy saved." })).toBeVisible()
  const policy = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0].resourcePolicy)
  expect(policy.cpu.preferred).toBe(0.3); expect(policy.memoryGb.preferred).toBe(0.375); expect(policy.priority).toBe("high")
  expect(policy.dynamic).toBe(true)
})

test("configuration sidebar start failures stay visible and actions unlock for retry", async ({ page }) => {
  await openGraph(page)
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts", { platformApi } = await import(url)
    const original = platformApi.setEnvironmentStatus
    platformApi.setEnvironmentStatus = async () => {
      await new Promise(resolve => window.addEventListener("finish-start-test", resolve, { once: true }))
      platformApi.setEnvironmentStatus = original
      throw new Error("Runtime could not start. Please retry.")
    }
  })
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Alpha", exact: true })
  await sheet.getByRole("button", { name: "Start", exact: true }).click()
  await expect(sheet.getByRole("status")).toHaveText("Starting…")
  await expect(sheet.getByRole("button", { name: "Start", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(sheet.getByRole("button", { name: "Start", exact: true })).toBeDisabled()
  await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeDisabled()
  await expect(sheet.getByRole("button", { name: "More environment actions", exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event("finish-start-test")))
  await expect(sheet.getByRole("alert")).toContainText("Please retry")
  await sheet.getByRole("button", { name: "Start", exact: true }).click()
  await expect(sheet.getByRole("alert")).toHaveCount(0)
  await expect(sheet.locator('[data-slot="sheet-header"]')).toContainText("Running")
  await expect(sheet.getByRole("button", { name: "Open", exact: true })).toBeEnabled()
})

async function holdAction(page: Page, method: "setEnvironmentStatus" | "openEnvironmentWindow", fail = false) {
  await page.evaluate(async ({ method, fail }) => {
    const url = "/src/api/platform-api.ts", { platformApi } = await import(url)
    const api = platformApi as Record<string, (...args: unknown[]) => Promise<unknown>>
    const original = api[method]!
    localStorage.setItem(`test-calls:${method}`, "0")
    api[method] = async (...args) => {
      localStorage.setItem(`test-calls:${method}`, String(Number(localStorage.getItem(`test-calls:${method}`)) + 1))
      await new Promise(resolve => window.addEventListener(`finish:${method}`, resolve, { once: true }))
      api[method] = original
      if (fail) throw new Error("Test operation failed. Please retry.")
      return method === "openEnvironmentWindow" ? true : original(...args)
    }
  }, { method, fail })
}

test("dashboard action styling stays compact, accessible and usable in both themes", async ({ page }) => {
  await openGraph(page)
  const toolbar = page.getByRole("group", { name: "Dashboard actions", exact: true })
  const theme = toolbar.getByRole("switch", { name: "Dark mode", exact: true })
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const dark of [false, true]) {
      await theme.setChecked(dark)
      await expect(theme).toBeChecked({ checked: dark })
      const charts = await page.locator(".resource-metric").evaluateAll(elements => elements.map(element => {
        const svg = element.querySelector("svg")!
        return { height: svg.getBoundingClientRect().height, width: element.clientWidth, scrollWidth: element.scrollWidth, color: getComputedStyle(svg).color }
      }))
      expect(charts).toHaveLength(3)
      expect(new Set(charts.map(chart => chart.color)).size).toBe(3)
      for (const chart of charts) {
        expect(chart.height).toBe(28)
        expect(chart.scrollWidth).toBeLessThanOrEqual(chart.width)
      }
      await expect(toolbar.locator("svg")).toHaveCount(0)
      const boxes = await toolbar.locator(".dashboard-action").evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, right: box.right, height: box.height, width: box.width, radius: getComputedStyle(element).borderRadius, cloud: element.matches('[data-tour="cloud-environment"]'), backgroundImage: getComputedStyle(element).backgroundImage }
      }))
      expect(boxes).toHaveLength(6)
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.height).toBe(34)
        expect(box.width).toBeGreaterThanOrEqual(36)
        expect(box.radius).toBe(box.cloud ? "0px 7px 7px 0px" : "7px")
        expect(box.backgroundImage).toBe("none")
        if (width >= 1024) expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(1)
      }
      // The toolbar now wraps naturally instead of imposing two fixed columns.
      for (let i = 0; i < boxes.length; i++) for (const other of boxes.slice(i + 1)) {
        const box = boxes[i]
        expect(box.right <= other.x || other.right <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y).toBe(true)
      }
      const launch = page.locator('[data-environment-id="Alpha"] .node-launch')
      expect(await launch.evaluate(element => getComputedStyle(element).height)).toBe("28px")
      await expect(launch).toHaveAccessibleName("Start")
      await expect(launch.locator("svg")).toHaveCount(0)
      expect(await launch.evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none")
    }
  }
  await toolbar.getByRole("button", { name: "Load local backup", exact: true }).click()
  const backup = page.getByRole("dialog", { name: "Load a local backup", exact: true })
  await expect(backup).toBeVisible()
  await backup.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(backup).not.toBeVisible()
  const create = toolbar.getByRole("button", { name: "New environment", exact: true })
  await create.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "New environment", exact: true })).toBeVisible()
})

test("persistent notifications do not block mobile dialog actions and can be dismissed", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openGraph(page)
  expect((await page.locator("[data-environment-canvas]").boundingBox())!.height).toBeGreaterThanOrEqual(320)
  await page.evaluate(async () => {
    const path = "/src/components/ui/toast.tsx"
    const { toastManager } = await import(path)
    toastManager.add({ title: "Persistent test warning", description: "This notice stays until dismissed.", timeout: 0, type: "warning" })
  })
  await expect(page.getByText("Persistent test warning", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Load local backup", exact: true }).click()
  const backup = page.getByRole("dialog", { name: "Load a local backup", exact: true })
  await expect(backup).toBeVisible()
  // A real click must reach the modal even while the persistent toast is present.
  await backup.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(backup).not.toBeVisible()
  await expect(page.getByText("Persistent test warning", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click()
  await expect(page.getByText("Persistent test warning", { exact: true })).toBeHidden()
})

test("environment action loading spans start through window opening without blocking other nodes", async ({ page }) => {
  await openGraph(page)
  await holdAction(page, "setEnvironmentStatus")
  await holdAction(page, "openEnvironmentWindow")
  const node = page.locator('[data-environment-id="Alpha"]')
  const other = page.locator('[data-environment-id="Beta"]')
  await node.getByRole("button", { name: "Start", exact: true }).click()
  await expect(node.getByRole("status")).toHaveText("Starting…")
  await expect(node.getByRole("button", { name: "Start", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(node.locator('[data-slot="button-loading-indicator"]')).toHaveCount(1)
  expect(await node.locator(".node-launch").evaluate(element => getComputedStyle(element).color)).toBe("rgba(0, 0, 0, 0)")
  await expect(other.getByRole("button", { name: "Start", exact: true })).toBeEnabled()
  await expect(other).toHaveAttribute("aria-busy", "false")
  // Opening settings mid-operation must show the same pending state.
  await node.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Alpha", exact: true })
  await expect(sheet.getByRole("button", { name: "Start", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(sheet.getByRole("button", { name: "Open", exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event("finish:setEnvironmentStatus")))
  await expect(sheet.getByRole("status")).toHaveText("Opening…")
  await expect(node.locator('button[data-loading]')).toHaveAttribute("aria-busy", "true")
  await expect(node.locator('button[aria-label="Shut down Alpha"]')).toBeDisabled()
  await expect(sheet.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-busy", "true")
  expect(await page.evaluate(() => localStorage.getItem("test-calls:setEnvironmentStatus"))).toBe("1")
  expect(await page.evaluate(() => localStorage.getItem("test-calls:openEnvironmentWindow"))).toBe("1")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:openEnvironmentWindow")))
  await expect(node.getByRole("button", { name: "Open", exact: true })).toBeEnabled()
  await expect(node.locator('[data-slot="button-loading-indicator"]')).toHaveCount(0)
  await expect(sheet).toHaveCount(0)
})

test("pause and stop show loading on the clicked node control and failure unlocks retry", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await openGraph(page, [env])
  const node = page.locator('[data-environment-id="Alpha"]')
  await holdAction(page, "setEnvironmentStatus", true)
  await node.getByRole("button", { name: "Pause Alpha", exact: true }).click()
  await expect(node.getByRole("button", { name: "Pause Alpha", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(node.getByRole("status")).toHaveText("Pausing…")
  await expect(node.getByRole("button", { name: "Shut down Alpha", exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event("finish:setEnvironmentStatus")))
  await expect(node.getByRole("button", { name: "Pause Alpha", exact: true })).toBeEnabled()
  await expect(node.locator('[data-slot="button-loading-indicator"]')).toHaveCount(0)
  await expect(page.getByText("Test operation failed. Please retry.").first()).toBeVisible()
  await holdAction(page, "setEnvironmentStatus")
  await node.getByRole("button", { name: "Shut down Alpha", exact: true }).click()
  await expect(node.getByRole("button", { name: "Shut down Alpha", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(node.getByRole("status")).toHaveText("Stopping…")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:setEnvironmentStatus")))
  await expect(node.getByRole("button", { name: "Start", exact: true })).toBeEnabled()
  await expect(node.locator('[data-slot="button-loading-indicator"]')).toHaveCount(0)
})

test("opening failure clears the node spinner and allows a new attempt", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await openGraph(page, [env])
  const node = page.locator('[data-environment-id="Alpha"]')
  await holdAction(page, "openEnvironmentWindow", true)
  await node.getByRole("button", { name: "Open", exact: true }).click()
  await expect(node.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-busy", "true")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:openEnvironmentWindow")))
  await expect(node.getByRole("button", { name: "Open", exact: true })).toBeEnabled()
  await expect(page.getByText("Test operation failed. Please retry.").first()).toBeVisible()
  await holdAction(page, "openEnvironmentWindow")
  await node.getByRole("button", { name: "Open", exact: true }).click()
  await expect(node.getByRole("status")).toHaveText("Opening…")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:openEnvironmentWindow")))
  await expect(node.getByRole("button", { name: "Open", exact: true })).toBeEnabled()
})

test("workspace window and lifecycle controls show pending spinners until completion", async ({ page }) => {
  const env = fixture("env-loading"); env.status = "running"
  const state = structuredClone(seed) as PlatformState; state.environments = [env]
  state.host.totalCpu = 8; state.host.totalMemoryGb = 16
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-loading")
  await expect(page.getByRole("tabpanel").locator(".xterm")).toBeVisible()
  await holdAction(page, "openEnvironmentWindow", true)
  await page.getByRole("button", { name: "New window", exact: true }).click()
  await expect(page.getByRole("button", { name: "New window", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(page.getByRole("button", { name: "Workspace actions", exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event("finish:openEnvironmentWindow")))
  await expect(page.getByRole("button", { name: "New window", exact: true })).toBeEnabled()
  await expect(page.getByRole("alert")).toContainText("Please retry")
  await holdAction(page, "setEnvironmentStatus")
  await page.getByRole("button", { name: "Workspace actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Stop environment", exact: true }).click()
  await expect(page.getByRole("button", { name: "Workspace actions", exact: true })).toHaveAttribute("aria-busy", "true")
  await expect(page.getByRole("status")).toContainText("Stopping…")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:setEnvironmentStatus")))
  await expect(page.getByRole("button", { name: "Start environment", exact: true })).toBeVisible()
  await holdAction(page, "setEnvironmentStatus")
  await page.getByRole("button", { name: "Start environment", exact: true }).click()
  await expect(page.getByRole("button", { name: "Start environment", exact: true })).toHaveAttribute("aria-busy", "true")
  await page.evaluate(() => window.dispatchEvent(new Event("finish:setEnvironmentStatus")))
  await expect(page.getByRole("tabpanel").locator(".xterm")).toBeVisible()
  await expect(page.getByRole("button", { name: "New window", exact: true })).toBeEnabled()
})

test("configuration sidebar creates snapshots and preserves restore confirmation", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Configure Alpha", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Alpha", exact: true })
  await sheet.getByRole("tab", { name: "Snapshots", exact: true }).click()
  await expect(sheet).toContainText("No snapshots for this environment")
  await sheet.getByRole("button", { name: "New snapshot", exact: true }).click()
  const create = page.getByRole("dialog", { name: "Create snapshot", exact: true })
  await create.getByRole("textbox", { name: "Name", exact: true }).fill("Before migration")
  await create.getByRole("button", { name: "Create snapshot", exact: true }).click()
  await expect(create).not.toBeVisible()
  await expect(sheet).toContainText("Before migration")
  await sheet.getByRole("button", { name: "Restore", exact: true }).click()
  const confirm = page.getByRole("alertdialog", { name: "Restore Before migration?", exact: true })
  await expect(confirm).toContainText("shut down and return to this point")
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).not.toBeVisible()
  await sheet.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(sheet).toContainText("No snapshots for this environment")
})

test("My PC chooses folders, defaults to read-only, mounts and disconnects", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await openGraph(page, [env])
  await drag(page, dockPort(page, "pc"), port(page))
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "My PC · Alpha" })).toBeVisible()
  await expect(dialog.getByRole("checkbox")).not.toBeChecked()
  await dialog.getByRole("button", { name: "Choose folders", exact: true }).click()
  await expect(dialog.getByText("C:\\Shared project", { exact: true })).toBeVisible()
  await expect(line(page, "pc")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Connect selected folders", exact: true }).click()
  await expect(dialog.locator("code")).toContainText("/opendock/shared/my-pc/")
  await dialog.getByRole("button", { name: "Done", exact: true }).click()
  await assertLineAligned(page, "pc")
  await dockPort(page, "pc").click(); await port(page).click()
  await dialog.getByRole("button", { name: "Disconnect C:\\Shared project", exact: true }).click()
  await expect(line(page, "pc")).toHaveCount(0)
})

test("GPU is a category and legacy CUDA nodes have no Shared GPU connector", async ({ page }) => {
  const env = { ...fixture("Alpha"), provider: "openDockCuda", gpuAccess: true }
  await openGraph(page, [env])
  await expect(page.locator('[data-environment-id="Alpha"]')).toContainText("GPU · NVIDIA CUDA")
  await expect(page.locator('[data-capability-kind="gpu"]')).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose shared GPU", exact: true })).toHaveCount(0)
  await expect(page.locator('[data-capability-kind="pc"]')).toBeVisible()
  await expect(page.locator('[data-capability-kind="internet"]')).toBeVisible()
})

test("GPU creation explains unsupported browser hardware and cannot claim CUDA works", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  await dialog.getByText("GPU", { exact: true }).click()
  await expect(dialog.getByRole("region", { name: "NVIDIA CUDA runtime" })).toContainText("desktop app")
  await expect(dialog.getByRole("button", { name: "Set up CUDA", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Create environment", exact: true })).toBeDisabled()
})

test("public access uses only Cloudflare and preserves independent local connections", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await seedServices(page); await openGraph(page, [env])
  const service = page.locator('[data-service-connection-point="Alpha:4200"]')
  await expect(service).toBeAttached()
  const dialog = page.getByRole("dialog")
  for (const kind of ["local", "cloudflare"]) {
    const destination = page.locator(`[data-publication-connection-point="${kind === "local" ? "local" : "public"}"]`)
    // Exercise both drag directions against the combined public connector.
    await drag(page, kind === "cloudflare" ? destination : service, kind === "cloudflare" ? service : destination)
    await expect(dialog.getByRole("heading", { name: "Port 4200 · Alpha" })).toBeVisible()
    await expect(dialog.getByRole("radiogroup", { name: "Publish to", exact: true }).getByRole("radio")).toHaveCount(2)
    await expect(dialog.getByRole("radio", { name: "Direct public IP", exact: true })).toHaveCount(0)
    await expect(dialog.getByRole("radiogroup", { name: "Public access method", exact: true })).toHaveCount(0)
    if (kind === "cloudflare") await expect(dialog.getByRole("radio", { name: "Quick link — no account", exact: true })).toBeChecked()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opendock.workspace.v1")!).Alpha.publications.length)).toBe(["local", "cloudflare"].indexOf(kind))
    await dialog.getByRole("button", { name: kind === "local" ? "Connect local network" : "Publish service", exact: true }).click()
    await expect(dialog.getByRole("button", { name: `Disconnect ${kind} from port 4200`, exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
  }
  await expect(page.locator('[data-service-card="Alpha:4200"]')).toContainText("LAN · CF")
  await expect(page.locator('[data-service-card="Alpha:8080"]')).not.toContainText("LAN")
  await expect(page.locator('[data-capability-line^="pub-"]')).toHaveCount(2)
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    // The opaque dock surface must not sit above the wire layer. Cards remain
    // above wires, so the lines reach sockets without crossing button labels.
    expect(await page.getByRole("region", { name: "Service destinations" }).evaluate(section => {
      const surface = getComputedStyle(section, "::before")
      const dock = getComputedStyle(section)
      const wireLayer = getComputedStyle(document.querySelector("[data-capability-lines]")!)
      const card = getComputedStyle(section.querySelector("[data-publication-card]")!)
      return dock.zIndex === "auto" && dock.backgroundColor === "rgba(0, 0, 0, 0)"
        && Number(surface.zIndex) < Number(wireLayer.zIndex)
        && Number(card.zIndex) > Number(wireLayer.zIndex)
    })).toBe(true)
  }
  await expect(page.locator('[data-publication-card="public"]').getByLabel("1 connected")).toBeVisible()
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  await dialog.getByRole("button", { name: "Disconnect cloudflare from port 4200", exact: true }).click()
  await expect(page.locator('[data-capability-line^="pub-"]')).toHaveCount(1)
  await expect(dialog.getByRole("button", { name: "Disconnect local from port 4200", exact: true })).toBeVisible()
})

test("existing direct public connections can still be disconnected", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await page.addInitScript(() => localStorage.setItem("opendock.workspace.v1", JSON.stringify({ Alpha: {
    services: [], shares: [], notice: "", publications: [{ id: "legacy-public", environmentId: "Alpha", port: 4200, kind: "public", hostPort: 14200, urls: ["http://127.0.0.1:14200"], status: "active", message: "Existing connection" }],
  } })))
  await openGraph(page, [env])
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("radio", { name: "Public access / Cloudflare Tunnel", exact: true }).check()
  await expect(dialog.getByRole("radio", { name: "Direct public IP", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("radio", { name: "Quick link — no account", exact: true })).toBeChecked()
  await dialog.getByRole("button", { name: "Disconnect public from port 4200", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Disconnect public from port 4200", exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opendock.workspace.v1")!).Alpha.publications.length)).toBe(0)
})

test("desktop VM manual ports validate before adding a connectable service", async ({ page }) => {
  const env = fixture("Alpha", "fullVm"); env.status = "running"
  await openGraph(page, [env])
  await page.getByRole("button", { name: "Add service port to Alpha", exact: true }).click()
  await page.getByRole("textbox", { name: "Guest TCP port" }).fill("70000")
  await page.getByRole("button", { name: "Add port", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Enter a port")
  await page.getByRole("textbox", { name: "Guest TCP port" }).fill("3000")
  await page.getByRole("button", { name: "Add port", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Port 3000 · Alpha" })).toBeVisible()
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(page.locator('[data-service-connection-point="Alpha:3000"]')).toBeAttached()
})

test("PORT labels open service ports on containers, MicroVMs and VMs and the guide highlights PORT", async ({ page }) => {
  await openGraph(page, [fixture("Container"), fixture("Micro", "microVm"), fixture("VM", "fullVm")])
  for (const name of ["Container", "Micro", "VM"]) {
    const button = page.getByRole("button", { name: `Add service port to ${name}`, exact: true })
    await expect(button).toHaveText("PORT")
    await expect(button.locator("svg")).toHaveCount(0)
    await button.click()
    const dialog = page.getByRole("dialog", { name: `Add a service port · ${name}`, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  }
  const before = await page.evaluate(() => [localStorage.getItem("opendock.platform.v1"), localStorage.getItem("opendock.workspace.manual.v2")])
  await page.getByRole("button", { name: "Instructions", exact: true }).click()
  const guide = page.locator(".tour-card")
  for (const expected of overviewSteps.slice(1, overviewSteps.indexOf("service-ports") + 1)) {
    await guide.getByRole("button", { name: "Next", exact: true }).click()
    await expect(page.locator("[data-tour-step]")).toHaveAttribute("data-tour-step", expected)
  }
  await expect(guide.getByRole("heading", { name: "Add a service port", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const button = document.querySelector('[data-tour="node-port"]')!.getBoundingClientRect()
    return [...document.querySelectorAll("[data-tour-highlight]")].some(element => {
      const ring = element.getBoundingClientRect()
      return ring.left <= button.left && ring.top <= button.top && ring.right >= button.right && ring.bottom >= button.bottom
    })
  })).toBe(true)
  await guide.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.locator("[data-tour-step]")).toHaveAttribute("data-tour-step", "connections")
  await expect(guide.getByRole("heading", { name: "Connect environments privately", exact: true })).toBeVisible()
  await guide.getByRole("button", { name: "Skip", exact: true }).click()
  expect(await page.evaluate(() => [localStorage.getItem("opendock.platform.v1"), localStorage.getItem("opendock.workspace.manual.v2")])).toEqual(before)
})

test("add service port has a compact responsive layout with long environment names", async ({ page }) => {
  const env = fixture("Alpha"); env.name = "Development workspace with a very long descriptive name for the database service"
  await openGraph(page, [env])
  await page.getByRole("button", { name: `Add service port to ${env.name}`, exact: true }).click()
  const dialog = page.getByRole("dialog", { name: `Add a service port · ${env.name}`, exact: true })
  await expect(dialog.getByRole("textbox", { name: "Guest TCP port", exact: true })).toBeFocused()
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    const bounds = (await dialog.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(800)
    expect(bounds.height).toBeLessThan(550)
    expect((await dialog.locator('[data-slot="dialog-header"]').boundingBox())!.height).toBeLessThanOrEqual(58)
  }
  for (const viewport of [{ width: 900, height: 600 }, { width: 390, height: 650 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const footer = element.querySelector('[data-slot="dialog-footer"]')!.getBoundingClientRect()
      const overflow = [...element.querySelectorAll('[data-slot="scroll-area-viewport"]')].some(el => el.scrollWidth > el.clientWidth + 1)
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight && footer.bottom <= bounds.bottom && !overflow
    })).toBe(true)
    await expect(dialog.getByRole("button", { name: "Add port", exact: true })).toBeInViewport()
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("opendock.manual-ports.v1"))).toBeNull()
})

test("add service port presets only fill the field and Enter opens unpublished connection options", async ({ page }) => {
  await openGraph(page, [fixture("Alpha")])
  await page.getByRole("button", { name: "Add service port to Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add a service port · Alpha", exact: true })
  await expect(dialog.getByRole("status")).toContainText("Start this environment before connecting")
  for (const value of ["3000", "4200", "5173", "8080", "27017"]) {
    await dialog.getByRole("button", { name: value, exact: true }).click()
    await expect(dialog.getByRole("textbox", { name: "Guest TCP port", exact: true })).toHaveValue(value)
    await expect(dialog.getByRole("button", { name: value, exact: true })).toHaveAttribute("aria-pressed", "true")
    expect(await page.evaluate(() => localStorage.getItem("opendock.manual-ports.v1"))).toBeNull()
  }
  await dialog.getByRole("textbox", { name: "Guest TCP port", exact: true }).press("Enter")
  const connections = page.getByRole("dialog", { name: "Port 27017 · Alpha", exact: true })
  await expect(connections).toBeVisible()
  await expect(connections.getByRole("button", { name: "Connect local network", exact: true })).toBeDisabled()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.workspace.manual.v2")!).Alpha)).toEqual([27017])
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.workspace.v1") ?? "{}").Alpha?.publications ?? [])).toEqual([])
  await connections.getByRole("button", { name: "Done", exact: true }).click()
  await expect(page.locator('[data-service-connection-point="Alpha:27017"]')).toBeAttached()
  await page.getByRole("button", { name: "Add service port to Alpha", exact: true }).click()
  await expect(dialog.getByRole("textbox", { name: "Guest TCP port", exact: true })).toHaveValue("")
  await dialog.getByRole("button", { name: "27017", exact: true }).click()
  await dialog.getByRole("button", { name: "Add port", exact: true }).click()
  await expect(connections).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.workspace.manual.v2")!).Alpha)).toEqual([27017])
})

test("add service port rejects invalid and reserved values without truncation or mutation", async ({ page }) => {
  await openGraph(page, [fixture("Alpha", "fullVm")])
  await page.getByRole("button", { name: "Add service port to Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add a service port · Alpha", exact: true })
  const portInput = dialog.getByRole("textbox", { name: "Guest TCP port", exact: true })
  await expect(dialog).toContainText("0.0.0.0")
  for (const value of ["", "0", "-1", "7443", "65536", "655350", "3.5", "abc", "3000,4200"]) {
    await portInput.fill(value)
    await dialog.getByRole("button", { name: "Add port", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("Enter a port from 1 to 65535")
    await expect(portInput).toHaveValue(value)
    await expect(portInput).toBeFocused()
    expect(await page.evaluate(() => localStorage.getItem("opendock.manual-ports.v1"))).toBeNull()
  }
  await portInput.fill(" 65535 ")
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await portInput.press("Enter")
  await expect(page.getByRole("heading", { name: "Port 65535 · Alpha", exact: true })).toBeVisible()
})

test("independent terminal tabs retain output when switching environments", async ({ page }) => {
  const first = fixture("env-Alpha"), second = fixture("env-Beta"); first.status = "running"; second.status = "running"
  const state = structuredClone(seed) as PlatformState; state.environments = [first, second]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-Alpha")
  const screen = () => page.getByRole("tabpanel")
  await expect(screen().locator(".xterm")).toBeVisible()
  await expect(screen().locator(".xterm-screen")).toContainText("Yougori test terminal")
  await screen().locator(".xterm-helper-textarea").focus(); await page.keyboard.type("echo first-tab"); await page.keyboard.press("Enter")
  await expect(screen().locator(".xterm-screen")).toContainText("first-tab")
  await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).click()
  await expect(page.getByRole("tab")).toHaveCount(2)
  await expect(screen().locator(".xterm-screen")).toContainText("Yougori test terminal")
  await expect(screen().locator(".xterm-screen")).not.toContainText("first-tab")
  await screen().locator(".xterm-helper-textarea").focus(); await page.keyboard.type("echo second-tab"); await page.keyboard.press("Enter")
  await page.getByRole("tab", { name: "env-Alpha · Terminal 1", exact: true }).click()
  await expect(screen().locator(".xterm-screen")).toContainText("first-tab")
  await expect(screen().locator(".xterm-screen")).not.toContainText("second-tab")
  await page.getByRole("combobox", { name: "Switch environment", exact: true }).click()
  await page.getByRole("option", { name: "env-Beta", exact: true }).click()
  await expect(page.getByRole("tab", { selected: true })).toHaveText("env-Beta · Terminal 1")
  await expect(page.getByRole("tab")).toHaveCount(3)
  await page.getByRole("button", { name: "Close env-Alpha tab 2", exact: true }).click()
  await expect(page.getByRole("tab")).toHaveCount(2)
})

async function chooseInstaller(page: Page, name = "Codex") {
  await page.getByRole("button", { name: "Install tools", exact: true }).click()
  await page.getByRole("menuitem", { name: `Install ${name}`, exact: true }).click()
}

test("coding-tool dropdown starts automatically in fresh container terminals without touching existing input", async ({ page }) => {
  test.setTimeout(90000)
  const state = structuredClone(seed) as PlatformState
  const first = fixture("env-install"), second = fixture("env-install-other")
  first.status = "running"; second.status = "running"; first.networkAccess = true; second.networkAccess = true
  state.environments = [first, second]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-install")
  // A cold Vite start must compile the lazy workspace and terminal modules.
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeEnabled({ timeout: 60000 })
  await page.evaluate(async () => {
    const module = "/src/api/workspace-api.ts", { workspaceApi } = await import(module)
    const original = workspaceApi.terminal
    const writes: { environmentId: string; sessionId: string; data: string }[] = []
    Object.assign(window, { installerWrites: writes })
    workspaceApi.terminal = (...args: Parameters<typeof original>) => {
      if (args[2] === "write") writes.push({ environmentId: args[0], sessionId: args[1], data: atob(args[3]?.data ?? "") })
      return original(...args)
    }
  })
  for (const [index, { name, id }] of terminalInstallers.entries()) {
    if (index) await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).click()
    await chooseInstaller(page, name)
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(page.getByRole("status")).toContainText("installation starts automatically")
    if (id === "ollama") await expect(page.getByRole("status")).toContainText("No model is downloaded")
    await expect.poll(() => page.evaluate(() => (window as unknown as { installerWrites: unknown[] }).installerWrites.length)).toBe(index + 1)
    await expect(page.getByRole("tabpanel").locator(".xterm-helper-textarea")).toBeFocused()
    await expect(page.getByRole("tab", { selected: true })).toContainText("Install " + name)
    await chooseInstaller(page, name)
    expect(await page.evaluate(() => (window as unknown as { installerWrites: unknown[] }).installerWrites.length)).toBe(index + 1)
    const selectedTab = page.getByRole("tab", { selected: true })
    const number = (await selectedTab.getAttribute("aria-label"))!.split(" ").at(-1)!
    await page.getByRole("button", { name: "Close env-install tab " + number, exact: true }).click()
  }
  const writes = await page.evaluate(() => (window as unknown as { installerWrites: { environmentId: string; sessionId: string; data: string }[] }).installerWrites)
  expect(new Set(writes.map(write => write.sessionId)).size).toBe(terminalInstallers.length)
  expect(writes.every(write => write.environmentId === "env-install" && write.data.endsWith("\r") && write.data.length < 200)).toBe(true)
  for (const [index, tool] of terminalInstallers.entries()) expect(writes[index]!.data).toBe(`exec sh '/tmp/opendock-install.${tool.id}/install.sh'\r`)
  await page.getByRole("combobox", { name: "Switch environment", exact: true }).click()
  await page.getByRole("option", { name: "env-install-other", exact: true }).click()
  await chooseInstaller(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { installerWrites: { environmentId: string }[] }).installerWrites.at(-1)?.environmentId)).toBe("env-install-other")
})

test("coding-tool installation requires internet without enabling it automatically", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const env = fixture("env-install-offline"); env.status = "running"
  state.environments = [env]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-install-offline")
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeEnabled()
  await chooseInstaller(page)
  await expect(page.getByRole("alert")).toContainText("Connect Internet access")
  await expect(page.getByRole("tab")).toHaveCount(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0].networkAccess)).toBe(false)
})

test("installer preparation failure preserves the existing prompt and can be retried", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const env = fixture("env-install-retry"); env.status = "running"; env.networkAccess = true
  state.environments = [env]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-install-retry")
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeEnabled()
  await page.getByRole("tabpanel").locator(".xterm-helper-textarea").focus()
  await page.keyboard.type("echo unfinished")
  await expect(page.getByRole("tabpanel").locator(".xterm-screen")).toContainText("echo unfinished")
  await page.evaluate(async () => {
    const module = "/src/api/workspace-api.ts", { workspaceApi } = await import(module)
    const prepare = workspaceApi.prepareInstaller
    workspaceApi.prepareInstaller = async () => { workspaceApi.prepareInstaller = prepare; throw new Error("Fixture: image has no writable /tmp") }
  })
  await chooseInstaller(page)
  await expect(page.getByRole("alert")).toContainText("image has no writable /tmp")
  await page.getByRole("tab", { name: "env-install-retry · Terminal 1", exact: true }).click()
  await expect(page.getByRole("tabpanel").locator(".xterm-screen")).toContainText("echo unfinished")
  await expect(page.getByRole("tabpanel").locator(".xterm-screen")).not.toContainText("exec sh")
  await chooseInstaller(page)
  await expect(page.getByRole("tabpanel").locator(".xterm-screen")).toContainText("opendock-install.codex/install.sh")
})

test("closing a preparing install tab prevents delayed command execution", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const env = fixture("env-install-cancel"); env.status = "running"; env.networkAccess = true
  state.environments = [env]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-install-cancel")
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeEnabled()
  await page.evaluate(async () => {
    const module = "/src/api/workspace-api.ts", { workspaceApi } = await import(module)
    workspaceApi.prepareInstaller = async () => {
      document.documentElement.setAttribute("data-install-preparing", "true")
      await new Promise<void>(resolve => window.addEventListener("finish-install-prepare", () => resolve(), { once: true }))
      document.documentElement.setAttribute("data-install-prepared", "true")
      return "exec sh '/tmp/opendock-install.cancel/install.sh'"
    }
    const terminal = workspaceApi.terminal
    workspaceApi.terminal = (...args: Parameters<typeof terminal>) => {
      if (args[2] === "write") document.documentElement.setAttribute("data-install-written", "true")
      return terminal(...args)
    }
  })
  await chooseInstaller(page)
  await chooseInstaller(page)
  await expect(page.locator("html")).toHaveAttribute("data-install-preparing", "true")
  await expect(page.getByRole("tab")).toHaveCount(2)
  await page.getByRole("button", { name: "Close env-install-cancel tab 2", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("finish-install-prepare")))
  await expect(page.locator("html")).toHaveAttribute("data-install-prepared", "true")
  await expect(page.locator("html")).not.toHaveAttribute("data-install-written")
  await expect(page.getByRole("tab")).toHaveCount(1)
})

test("coding-tool controls stay left of New window at desktop and narrow widths", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const env = fixture("env-installer-layout"); env.status = "running"
  state.environments = [env]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-installer-layout")
  for (const width of [1440, 720, 360]) {
    await page.setViewportSize({ width, height: 600 })
    const newWindow = await page.getByRole("button", { name: "New window", exact: true }).boundingBox()
    const button = page.getByRole("button", { name: "Install tools", exact: true })
    await expect(button).toBeInViewport()
    const bounds = await button.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(newWindow!.x)
    await expect(page.getByRole("menuitem")).toHaveCount(0)
    await button.click()
    for (const { name } of terminalInstallers) await expect(page.getByRole("menuitem", { name: `Install ${name}`, exact: true })).toBeInViewport()
    await page.keyboard.press("Escape")
    await expect(button).toBeFocused()
    await expect(page.getByRole("menu")).toHaveCount(0)
    expect((await page.locator("[data-workspace-toolbar]").boundingBox())!.height).toBeLessThanOrEqual(44)
  }
})

test("coding-tool dropdown is disabled for stopped or ended terminals and absent on VM desktops", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  state.host.totalCpu = 8
  state.host.totalMemoryGb = 16
  state.environments = [fixture("env-install-stopped"), fixture("env-install-desktop", "fullVm")]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-install-stopped")
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeDisabled()
  await page.evaluate(async () => {
    const module = "/src/api/workspace-api.ts", { workspaceApi } = await import(module)
    const original = workspaceApi.terminal
    workspaceApi.terminal = async (...args: Parameters<typeof original>) => args[2] === "read" ? { data: "", offset: 0, done: true } : original(...args)
  })
  await page.getByRole("button", { name: "Start environment", exact: true }).click()
  await expect(page.getByRole("tabpanel").locator(".xterm-screen")).toContainText("Session ended")
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toBeDisabled()
  await page.getByRole("combobox", { name: "Switch environment", exact: true }).click()
  await page.getByRole("option", { name: "env-install-desktop", exact: true }).click()
  await expect(page.getByRole("button", { name: "Install tools", exact: true })).toHaveCount(0)
})

test("terminal keyboard copy and paste work without duplicate input", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const environment = fixture("env-clipboard"); environment.status = "running"; state.environments = [environment]
  await page.addInitScript(state => {
    localStorage.setItem("opendock.platform.v1", JSON.stringify(state))
    // Isolated clipboard: never read or overwrite the user's real clipboard.
    let text = "echo pasted-once"
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => text, writeText: async (value: string) => { text = value } } })
  }, state)
  await page.goto("/?environment=env-clipboard")
  const terminal = page.getByRole("tabpanel").locator(".xterm")
  await expect(terminal.locator(".xterm-screen")).toContainText("Yougori test terminal")
  await terminal.locator(".xterm-helper-textarea").focus()
  await page.keyboard.press("Control+v")
  await expect(terminal.locator(".xterm-rows > div").nth(1)).toHaveText("$ echo pasted-once")
  await page.keyboard.press("Enter")
  await expect(terminal.locator(".xterm-rows > div").nth(2)).toHaveText("pasted-once")
  await terminal.locator(".xterm-rows > div").nth(2).dblclick({ position: { x: 15, y: 8 } })
  await page.keyboard.press("Control+c")
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("pasted-once")
  await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).click()
  await expect(terminal.locator(".xterm-screen")).toContainText("Yougori test terminal")
  await page.evaluate(() => navigator.clipboard.writeText("echo shift-paste"))
  await terminal.locator(".xterm-helper-textarea").focus(); await page.keyboard.press("Control+Shift+v")
  await expect(terminal.locator(".xterm-rows > div").nth(1)).toHaveText("$ echo shift-paste")
})

test("terminal output automatically gets local QR cards scoped to its tab", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  const environment = fixture("env-qr"); environment.status = "running"; state.environments = [environment]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-qr")
  const terminal = () => page.getByRole("tabpanel").locator(".xterm")
  await expect(terminal().locator(".xterm-screen")).toContainText("Yougori test terminal")
  await terminal().locator(".xterm-helper-textarea").focus()
  await page.keyboard.type("echo https://example.com/setup?code=abc http://localhost:3000/"); await page.keyboard.press("Enter")
  const panel = () => page.getByRole("tabpanel")
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(2)
  await expect(panel().getByRole("img", { name: "QR code for https://example.com/setup?code=abc", exact: true })).toBeVisible()
  await expect(panel().getByText("Localhost is device-only.", { exact: false })).toBeVisible()
  await expect(terminal().locator(".xterm-screen")).toContainText("https://example.com/setup?code=abc")
  await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).click()
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(0)
  await page.getByRole("tab", { name: "env-qr · Terminal 1", exact: true }).click()
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(2)
  await panel().getByRole("button", { name: "Dismiss QR code for https://example.com/setup?code=abc", exact: true }).click()
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(1)
  await terminal().locator(".xterm-helper-textarea").focus()
  await page.keyboard.type("echo https://example.org/new"); await page.keyboard.press("Enter")
  // New output forces another scan of the old URL as well as the new one.
  await expect(panel().locator('[data-terminal-link="https://example.org/new"]')).toBeVisible()
  await expect(panel().locator('[data-terminal-link="https://example.com/setup?code=abc"]')).toHaveCount(0)
  await panel().getByRole("button", { name: "Dismiss QR code for http://localhost:3000/", exact: true }).click()
  await panel().getByRole("button", { name: "Dismiss QR code for https://example.org/new", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(panel().getByRole("region", { name: "Terminal link QR codes" })).toHaveCount(0)
  await page.getByRole("tab", { name: "env-qr · Terminal 2", exact: true }).click()
  await terminal().locator(".xterm-helper-textarea").focus()
  await page.keyboard.type("echo https://example.com/setup?code=abc"); await page.keyboard.press("Enter")
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(1)
  await page.getByRole("tab", { name: "env-qr · Terminal 1", exact: true }).click()
  await expect(panel().locator("[data-terminal-link]")).toHaveCount(0)
})

test("workspace chrome stays compact with long names and many tabs", async ({ page }) => {
  const environment = fixture("env-long-workspace")
  environment.name = "Development environment with a very long project name"
  environment.status = "running"
  const state = structuredClone(seed) as PlatformState
  state.environments = [environment]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.setViewportSize({ width: 720, height: 480 })
  await page.goto("/?environment=env-long-workspace")
  await expect(page.getByRole("tabpanel").locator(".xterm")).toBeVisible()
  const firstTab = await page.getByRole("tab").boundingBox()
  const addTab = await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).boundingBox()
  expect(firstTab).not.toBeNull(); expect(addTab).not.toBeNull()
  expect(addTab!.x - (firstTab!.x + firstTab!.width)).toBeLessThan(48)
  for (let index = 0; index < 5; index++) await page.getByRole("button", { name: "New terminal or desktop tab", exact: true }).click()
  await expect(page.getByRole("tab")).toHaveCount(6)
  await expect(page.getByRole("tab", { selected: true })).toBeInViewport()
  for (const width of [720, 360]) {
    await page.setViewportSize({ width, height: 480 })
    const measurements = await page.locator("[data-guest-workspace]").evaluate(element => {
      const toolbar = element.querySelector("[data-workspace-toolbar]")!
      const tabs = element.querySelector("[data-workspace-tabs]")!
      return { width: element.clientWidth, scrollWidth: element.scrollWidth, toolbar: toolbar.getBoundingClientRect().height, tabs: tabs.getBoundingClientRect().height }
    })
    expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width)
    expect(measurements.toolbar).toBeLessThanOrEqual(44)
    expect(measurements.tabs).toBeLessThanOrEqual(36)
    await expect(page.getByRole("button", { name: "Workspace actions", exact: true })).toBeInViewport()
    await expect(page.getByRole("combobox", { name: "Switch environment", exact: true })).toBeInViewport()
  }
  await page.getByRole("button", { name: "Switch window", exact: true }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(page.getByText("No other windows open.", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Switch window", exact: true })).toBeFocused()
  await page.getByRole("button", { name: `Close ${environment.name} tab 6`, exact: true }).click()
  await expect(page.getByRole("tab", { selected: true })).toHaveAccessibleName(`${environment.name} · Terminal 5`)
  await expect(page.getByRole("tabpanel")).toHaveCount(1)
})

for (const accelerated of [false, true]) test(`real QEMU ${accelerated ? "accelerated" : "basic"} viewer preserves proportions before guest drivers load`, async ({ page }) => {
  test.skip(process.platform !== "win32", "Uses the bundled Windows QEMU executable")
  test.setTimeout(60_000)
  const availablePort = () => new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") { server.close(); reject(new Error("No test port")); return }
      server.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
  const rfbPort = await availablePort()
  let websocketPort = await availablePort()
  while (websocketPort === rfbPort) websocketPort = await availablePort()
  // A paused, diskless, networkless test machine. Never open a user VM image.
  const directory = resolve("src-tauri/resources/runtime/qemu-secure")
  const qemu = spawn(resolve(directory, "qemu-system-x86_64.exe"), [
    "-L", resolve("src-tauri/resources/runtime/qemu/share"),
    "-machine", "q35", "-accel", "tcg", "-m", "64", "-nodefaults", "-S",
    "-device", accelerated ? "virtio-vga-gl,id=opendock-display,max_outputs=1" : "VGA",
    "-display", accelerated ? "egl-headless" : "none", "-monitor", "none",
    "-vnc", `127.0.0.1:${rfbPort - 5900},websocket=127.0.0.1:${websocketPort},share=force-shared`,
  ], { cwd: directory, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] })
  let startupError = ""
  qemu.stderr.on("data", data => { startupError = (startupError + String(data)).slice(-4096) })
  qemu.on("error", error => { startupError = error.message })
  const exited = new Promise<void>(done => qemu.once("close", () => done()))
  try {
    const state = structuredClone(seed) as PlatformState
    state.environments = [fixture("env-vnc-fixture", "fullVm")]
    await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
    await page.goto("/?environment=env-vnc-fixture")
    expect(qemu.exitCode, startupError).toBeNull()
    await page.evaluate(async url => {
      const modulePath = "/node_modules/@novnc/novnc/core/rfb.js"
      const { default: RFB } = await import(modulePath)
      const target = document.createElement("div")
      target.id = "real-vnc-fixture"
      target.style.cssText = "position:fixed;inset:0 auto auto 0;width:800px;height:500px;z-index:99999;overflow:hidden"
      document.body.append(target)
      const client = new RFB(target, url, { shared: true })
      client.scaleViewport = true
      client.resizeSession = true
      ;(window as unknown as { displayFixture: { disconnect(): void } }).displayFixture = client
      await new Promise<void>((resolveConnection, reject) => {
        const timeout = setTimeout(() => reject(new Error("Disposable VNC connection timed out")), 15_000)
        client.addEventListener("connect", () => { clearTimeout(timeout); resolveConnection() }, { once: true })
        client.addEventListener("disconnect", () => { clearTimeout(timeout); reject(new Error("Disposable VNC disconnected")) }, { once: true })
      })
    }, `ws://127.0.0.1:${websocketPort}`)
    const target = page.locator("#real-vnc-fixture"), canvas = target.locator("canvas")
    for (const [width, height] of [[800, 500], [500, 800], [1234, 777]]) {
      await target.evaluate((element, size) => { element.style.width = `${size[0]}px`; element.style.height = `${size[1]}px` }, [width, height])
      await expect.poll(async () => {
        const bounds = await canvas.boundingBox()
        const source = await canvas.evaluate(element => [element.width, element.height])
        return Boolean(bounds && Math.abs(bounds.width / bounds.height - source[0]! / source[1]!) < 0.001
          && bounds.width <= width + 1 && bounds.height <= height + 1
          && (Math.abs(bounds.width - width) < 1 || Math.abs(bounds.height - height) < 1))
      }).toBe(true)
    }
    // Matching the viewport to the actual framebuffer removes bars without
    // changing pixels, cropping the desktop, or pretending VGA supports resize.
    const source = await canvas.evaluate(element => [element.width, element.height])
    await target.evaluate((element, size) => { element.style.width = `${size[0]}px`; element.style.height = `${size[1]}px` }, source)
    await expect.poll(async () => {
      const bounds = await canvas.boundingBox()
      return bounds ? [Math.round(bounds.width), Math.round(bounds.height)] : null
    }).toEqual(source)
    await page.evaluate(() => { (window as unknown as { displayFixture: { disconnect(): void } }).displayFixture.disconnect() })
  } finally {
    // This child has no disks and has never run a guest instruction.
    if (qemu.exitCode === null) qemu.kill()
    await exited
  }
})

test("VM workspace offers real resolution resizing without a stretching mode", async ({ page }) => {
  const state = structuredClone(seed) as PlatformState
  state.environments = [fixture("env-display-options", "fullVm")]
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-display-options")
  await page.getByRole("button", { name: "Workspace actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Fit window to desktop", exact: true })).toBeVisible()
  await expect(page.getByRole("menu")).toContainText("Asks the guest to match the focused window")
  await expect(page.getByRole("menu")).toContainText("never stretched or cropped")
  await expect(page.getByRole("menu")).toContainText("move the pointer out to release it")
  await page.getByRole("menuitem", { name: "Keep guest resolution", exact: true }).click()
  await page.getByRole("button", { name: "Workspace actions", exact: true }).click()
  await expect(page.getByRole("menu")).toContainText("Keeps the resolution set inside the guest")
  await page.getByRole("menuitem", { name: "Auto-resize guest resolution", exact: true }).click()
  await page.getByRole("button", { name: "Workspace actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Keep guest resolution", exact: true })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Fill window edge to edge", exact: true })).toHaveCount(0)
})

test("workspace actions separate stopping from window navigation", async ({ page }) => {
  const environment = fixture("env-workspace-actions"); environment.status = "running"
  const state = structuredClone(seed) as PlatformState; state.environments = [environment]
  state.host.totalCpu = 8
  state.host.totalMemoryGb = 16
  await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
  await page.goto("/?environment=env-workspace-actions")
  await expect(page.getByRole("tabpanel").locator(".xterm")).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop environment", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Workspace actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Close window", exact: true })).toBeVisible()
  await page.getByRole("menuitem", { name: "Stop environment", exact: true }).click()
  await expect(page.getByRole("button", { name: "Start environment", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New window", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Start environment", exact: true }).click()
  await expect(page.getByRole("tabpanel").locator(".xterm")).toBeVisible()
  await expect(page.getByRole("button", { name: "New window", exact: true })).toBeEnabled()
})

for (const theme of ["light", "dark"]) {
  test(`workspace selection and fullscreen controls work in ${theme} mode`, async ({ page }) => {
    const state = structuredClone(seed) as PlatformState
    state.environments = [fixture("env-keyboard", "fullVm"), fixture("env-shell")]
    await page.addInitScript(state => localStorage.setItem("opendock.platform.v1", JSON.stringify(state)), state)
    await page.goto("/?environment=env-keyboard")
    await expect(page.getByRole("tab", { name: "env-keyboard · Desktop 1", exact: true })).toBeVisible()
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
    const picker = page.getByRole("combobox", { name: "Switch environment", exact: true })
    await picker.focus(); await page.keyboard.press("Enter")
    await expect(page.getByRole("option", { name: "env-shell", exact: true })).toContainText("Container · Stopped")
    await page.keyboard.press("End"); await page.keyboard.press("Enter")
    await expect(page.getByRole("tab", { selected: true })).toHaveAccessibleName("env-shell · Terminal 1")
    await page.getByRole("tab", { selected: true }).focus(); await page.keyboard.press("ArrowLeft")
    await expect(page.getByRole("tab", { name: "env-keyboard · Desktop 1", exact: true })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("tab", { selected: true })).toHaveAccessibleName("env-keyboard · Desktop 1")
    const fullscreen = page.getByRole("button", { name: "Toggle fullscreen", exact: true })
    await fullscreen.click()
    await expect(fullscreen).toHaveAttribute("aria-pressed", "true")
    await fullscreen.click()
    await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  })
}

test("connects with clicks or keyboard, accepts whole cards, and cancels cleanly", async ({ page }) => {
  await openGraph(page)
  await dockPort(page, "internet").focus()
  await page.keyboard.press("Enter")
  await port(page).focus()
  await page.keyboard.press("Enter")
  await assertLineAligned(page, "internet")
  await expect(page.locator('[data-capability-kind="gpu"]')).toHaveCount(0)
  await page.locator('[data-capability-kind="internet"]').click()
  await page.locator('[data-environment-id="Beta"] dl').click()
  await assertLineAligned(page, "internet", "Beta")
  await dockPort(page, "internet").click()
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-environment-graph]")).toHaveAttribute("data-connecting", "false")
  await expect(page.locator("[data-connection-preview]")).toHaveCount(0)
  await port(page).click()
  await page.locator("[data-environment-canvas]").click({ position: { x: 12, y: 12 } })
  await expect(page.locator("[data-environment-graph]")).toHaveAttribute("data-connecting", "false")
})

test("invalid and cancelled drops never change settings or open a dialog", async ({ page }) => {
  const running = fixture("Running")
  running.status = "running"
  await openGraph(page, [fixture("Alpha", "microVm"), running])
  await drag(page, dockPort(page, "internet"), port(page))
  await expect(page.getByRole("alert").filter({ hasText: "Internet access is available for OCI containers and VMs." })).toBeVisible()
  await expect(line(page, "internet")).toHaveCount(0)
  await expect(dockPort(page, "gpu")).toHaveCount(0)
  const start = await center(dockPort(page, "internet"))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(5, 5, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator("[data-environment-graph]")).toHaveAttribute("data-connecting", "false")
  await expect(page.locator("[data-capability-line]")).toHaveCount(0)
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0)
  await drag(page, dockPort(page, "internet"), port(page, "Running"))
  await assertLineAligned(page, "internet", "Running")
})

test("ports keep their size and wires follow movement, zoom, resize and card growth", async ({ page }) => {
  await openGraph(page)
  await drag(page, dockPort(page, "internet"), port(page))
  const dockBefore = await center(dockPort(page, "internet"))
  const grip = page.locator('[data-environment-id="Alpha"] [data-node-drag-grip]')
  const start = await center(grip)
  const nodeBefore = await center(port(page))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 60, start.y - 35, { steps: 10 })
  await page.mouse.up()
  const nodeAfter = await center(port(page))
  expect(nodeAfter.x - nodeBefore.x).toBeGreaterThan(50)
  expect(await center(dockPort(page, "internet"))).toEqual(dockBefore)
  await assertLineAligned(page, "internet")
  await page.getByRole("button", { name: "Zoom out", exact: true }).click({ clickCount: 3 })
  await assertLineAligned(page, "internet")
  expect((await port(page).boundingBox())!.width).toBeGreaterThanOrEqual(43)
  await page.getByRole("button", { name: "Fit environments", exact: true }).click()
  await assertLineAligned(page, "internet")
  await page.setViewportSize({ width: 390, height: 1100 })
  await page.getByRole("button", { name: "Fit environments", exact: true }).click()
  await assertLineAligned(page, "internet")
  const layout = await page.evaluate(() => {
    const points = [...document.querySelectorAll('section[aria-label="Environment capabilities"] [data-capability-connection-point]')].map(el => el.getBoundingClientRect())
    return { sameRow: points.every(point => Math.abs(point.top - points[0].top) < 1), overflow: document.documentElement.scrollWidth > innerWidth }
  })
  expect(layout).toEqual({ sameRow: true, overflow: false })
  expect((await port(page).boundingBox())!.width).toBeGreaterThanOrEqual(43)
})

test("touch drag connects through pointer capture", async ({ page, context }) => {
  await openGraph(page, [fixture("Alpha")])
  const session = await context.newCDPSession(page)
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true })
  const a = await center(dockPort(page, "internet")), b = await center(port(page))
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] })
  for (let step = 1; step <= 10; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + (b.x - a.x) * step / 10, y: a.y + (b.y - a.y) * step / 10 }] })
  }
  await expect(page.locator("[data-connection-preview]")).toBeAttached()
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await assertLineAligned(page, "internet")
  await session.detach()
})

test("panning keeps the dock fixed and hides wires to off-screen nodes", async ({ page }) => {
  await openGraph(page, [fixture("Alpha")])
  await drag(page, dockPort(page, "internet"), port(page))
  const dockBefore = await center(dockPort(page, "internet"))
  const canvas = (await page.locator("[data-environment-canvas]").boundingBox())!
  await page.mouse.move(canvas.x + 25, canvas.y + canvas.height - 40)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 25, canvas.y + 20, { steps: 10 })
  await page.mouse.up()
  await expect(line(page, "internet")).toHaveCount(0)
  expect(await center(dockPort(page, "internet"))).toEqual(dockBefore)
  await page.getByRole("button", { name: "Fit environments", exact: true }).click()
  await assertLineAligned(page, "internet")
})

test("network handles stay anchored on hover and still open the connection form", async ({ page }) => {
  await openGraph(page)
  const source = page.locator('[data-environment-id="Alpha"] .react-flow__handle-right')
  const target = page.locator('[data-environment-id="Beta"] .react-flow__handle-left')
  const before = await center(source)
  await source.hover()
  await expect.poll(async () => {
    const after = await center(source)
    return Math.hypot(after.x - before.x, after.y - before.y)
  }).toBeLessThan(0.5)
  const end = await center(target)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 15 })
  await page.mouse.up()
  await expect(page.getByRole("dialog", { name: "New connection" })).toBeVisible()
})

test("connection form is wide, compact and readable in both themes", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await expect(dialog.getByRole("combobox", { name: "From", exact: true })).toContainText("Alpha")
  await expect(dialog.getByRole("combobox", { name: "To", exact: true })).toContainText("Beta")
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    const layout = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect()
      const header = element.querySelector('[data-slot="dialog-header"]')!.getBoundingClientRect()
      const left = element.querySelector('.connection-permissions')!.getBoundingClientRect()
      const right = element.querySelector('.connection-details')!.getBoundingClientRect()
      const controls = [...element.querySelectorAll('.connection-direction')].map(el => el.getBoundingClientRect())
      return { width: box.width, height: box.height, header: header.height, sameRow: controls.every(control => Math.abs(control.top - controls[0].top) < 1), columns: right.left >= left.right - 1, fits: box.bottom <= innerHeight && box.left >= 0 }
    })
    expect(layout.width).toBeGreaterThanOrEqual(1000)
    expect(layout.height).toBeLessThan(760)
    expect(layout.header).toBeLessThanOrEqual(58)
    expect(layout.sameRow && layout.columns && layout.fits).toBe(true)
  }
  await expect(dialog.getByRole("checkbox")).toHaveCount(6)
  await expect(dialog.getByRole("checkbox", { name: "Files", exact: true })).toBeChecked()
})

test("connection form swaps endpoints and saves the selected rules", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  await dialog.getByRole("button", { name: "Swap source and destination" }).click()
  await expect(dialog.getByRole("combobox", { name: "From", exact: true })).toContainText("Beta")
  await dialog.getByRole("combobox", { name: "To", exact: true }).click()
  await expect(page.getByRole("option", { name: "Beta", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  await dialog.getByText("Bidirectional", { exact: true }).click()
  await dialog.getByRole("checkbox", { name: "Shared volumes", exact: true }).check()
  await dialog.getByPlaceholder("443, 5432, 6379").fill("3000, 5432")
  await dialog.getByPlaceholder("workspace-data").fill("app-data")
  await expect(dialog.getByRole("group", { name: "Access summary" })).toContainText("restricted to your allowed TCP ports")
  await dialog.getByRole("button", { name: "Create connection", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).connections.find((connection: { sourceId: string }) => connection.sourceId === "Beta"))
  expect(saved).toMatchObject({ sourceId: "Beta", targetId: "Alpha", direction: "bidirectional", permissions: ["ports", "volumes"], ports: ["3000", "5432"], volume: "app-data" })
})

test("connection form validates empty, invalid and duplicate TCP ports before saving", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  const submit = dialog.getByRole("button", { name: "Create connection", exact: true })
  await submit.click()
  await expect(dialog.getByRole("alert")).toContainText("Enter at least one TCP port")
  for (const value of ["65536", "0", "3000-3005", "1.5", "hello"]) {
    await dialog.getByPlaceholder("443, 5432, 6379").fill(value)
    await submit.click()
    await expect(dialog.getByRole("alert")).toContainText("between 1 and 65535")
  }
  await dialog.getByPlaceholder("443, 5432, 6379").fill("443, 0443")
  await submit.click()
  await expect(dialog.getByRole("alert")).toContainText("only be listed once")
  await dialog.getByRole("checkbox", { name: "Ports", exact: true }).uncheck()
  await submit.click()
  await expect(dialog.getByRole("alert")).toContainText("Select at least one permission")
})

test("connection form never submits hidden port or volume values", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  await dialog.getByPlaceholder("443, 5432, 6379").fill("invalid old draft")
  await dialog.getByRole("checkbox", { name: "Shared volumes", exact: true }).check()
  await dialog.getByPlaceholder("workspace-data").fill("invalid old / volume")
  await dialog.getByRole("checkbox", { name: "Network access", exact: true }).check()
  await expect(dialog.getByRole("group", { name: "Access summary" })).toContainText("TCP port list does not restrict")
  await dialog.getByRole("checkbox", { name: "Ports", exact: true }).uncheck()
  await dialog.getByRole("checkbox", { name: "Shared volumes", exact: true }).uncheck()
  await expect(dialog.getByRole("textbox")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Create connection", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).connections.find((connection: { sourceId: string }) => connection.sourceId === "Alpha"))
  expect(saved.permissions).toEqual(["network"])
  expect(saved.ports).toEqual([])
  expect(saved.volume).toBeUndefined()
})

test("connection form blocks duplicate submission and preserves a failed draft for retry", async ({ page }) => {
  await openGraph(page)
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts", { platformApi } = await import(url)
    const original = platformApi.createConnection
    platformApi.createConnection = async () => {
      await new Promise(resolve => window.addEventListener("finish-connection-test", resolve, { once: true }))
      platformApi.createConnection = original
      throw new Error("Connection could not be saved. Please retry.")
    }
  })
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  const ports = dialog.getByPlaceholder("443, 5432, 6379")
  await ports.fill("4200")
  const submit = dialog.getByRole("button", { name: "Create connection", exact: true })
  await submit.click()
  await expect(submit).toBeDisabled()
  await expect(ports).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("finish-connection-test")))
  await expect(dialog.getByRole("alert")).toContainText("Please retry")
  await expect(ports).toHaveValue("4200")
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(dialog).not.toBeVisible()
})

test("connection form keeps drafts through telemetry and resets only when reopened", async ({ page }) => {
  await page.clock.install()
  const alpha = fixture("Alpha"); alpha.status = "running"
  await openGraph(page, [alpha, fixture("Beta")])
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts", { platformApi } = await import(url)
    const original = platformApi.refreshHostMetrics
    platformApi.refreshHostMetrics = async () => {
      const state = await original()
      document.documentElement.setAttribute("data-connection-poll", "done")
      return state
    }
  })
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  await dialog.getByPlaceholder("443, 5432, 6379").fill("8080, 3000")
  await dialog.getByRole("radio", { name: "One-way", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  await dialog.getByRole("checkbox", { name: "Files", exact: true }).check()
  await page.clock.fastForward(12_500)
  await expect(page.locator("html")).toHaveAttribute("data-connection-poll", "done")
  await expect(dialog.getByPlaceholder("443, 5432, 6379")).toHaveValue("8080, 3000")
  await expect(dialog.getByRole("checkbox", { name: "Files", exact: true })).toBeChecked()
  await expect(dialog.locator('input[type="radio"][value="bidirectional"]')).toBeChecked()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  await expect(dialog.getByRole("checkbox", { name: "Files", exact: true })).toBeChecked()
  await portsOnly(dialog)
  await expect(dialog.getByPlaceholder("443, 5432, 6379")).toHaveValue("")
  await expect(dialog.getByRole("checkbox", { name: "Files", exact: true })).not.toBeChecked()
})

test("connection form fits small windows, supports keyboard input and handles missing peers", async ({ page }) => {
  await openGraph(page)
  await page.getByRole("button", { name: "Connect Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New connection", exact: true })
  await portsOnly(dialog)
  for (const viewport of [{ width: 900, height: 700 }, { width: 390, height: 650 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const footer = element.querySelector('[data-slot="dialog-footer"]')!.getBoundingClientRect()
      const overflow = [...element.querySelectorAll('[data-slot="scroll-area-viewport"]')].some(el => el.scrollWidth > el.clientWidth + 1)
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight && footer.bottom <= bounds.bottom && !overflow
    })).toBe(true)
    await expect(dialog.getByRole("button", { name: "Create connection", exact: true })).toBeInViewport()
  }
  const ports = dialog.getByPlaceholder("443, 5432, 6379")
  await ports.fill("3000")
  await ports.press("Enter")
  await expect(dialog).not.toBeVisible()
  await page.setViewportSize({ width: 1280, height: 1000 })
  await openGraph(page, [fixture("Alone"), fixture("Branch", "computerBranch")])
  await page.getByRole("button", { name: "Connect Alone", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("at least two environments")
  await expect(dialog.getByRole("button", { name: "Create connection", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
})

test("workspace redesign keeps toolbar and metrics readable across desktop sizes", async ({ page }) => {
  await openGraph(page)
  for (const width of [980, 1280, 1920]) {
    await page.setViewportSize({ width, height: width === 980 ? 680 : 900 })
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
      const controls = page.locator('.dashboard-actions > button, .dashboard-actions > label')
      expect(await controls.evaluateAll(elements => elements.every(element => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth && rect.height >= 30
          && element.scrollWidth <= element.clientWidth + 2
      }))).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
      const canvas = await page.locator("[data-environment-canvas]").boundingBox()
      expect(canvas!.height).toBeGreaterThan(120)
      const capabilities = await page.getByRole("region", { name: "Environment capabilities", exact: true }).boundingBox()
      expect(capabilities!.y + capabilities!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      await expect(page.getByRole("region", { name: "Host resources and storage" })).toBeVisible()
      await expect(page.getByRole("button", { name: "New environment", exact: true })).toBeVisible()
      expect(await page.locator(".workspace-node").first().evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("3px")
    }
  }
})

test("connectors are reachable above both light and dark surfaces", async ({ page }) => {
  await openGraph(page)
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    const reachable = await page.locator("[data-environment-connection-point], [data-capability-connection-point]").evaluateAll(elements => elements.every(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      const dot = element.querySelector("span")!
      return bounds.width >= 43 && (hit === element || element.contains(hit)) && getComputedStyle(dot).backgroundColor !== "rgba(0, 0, 0, 0)"
    }))
    expect(reachable).toBe(true)
  }
})

test("newly created nodes stay visible and do not overlap existing cards", async ({ page }) => {
  await openGraph(page, [])
  for (const name of ["First", "Second"]) {
    await page.getByRole("button", { name: "New environment", exact: true }).click()
    await page.getByPlaceholder("Ubuntu Development").fill(name)
    await page.getByRole("dialog", { name: "New environment" }).getByRole("button", { name: "Create environment", exact: true }).click()
    await expect(page.getByRole("button", { name: `Connect capabilities to ${name}`, exact: true })).toBeVisible()
  }
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector("[data-environment-canvas]")!.getBoundingClientRect()
    const cards = [...document.querySelectorAll("[data-environment-id]")].map(el => el.getBoundingClientRect())
    return cards.length === 2 && cards.every(card => card.top >= canvas.top && card.bottom < canvas.bottom && card.left >= canvas.left && card.right <= canvas.right)
      && (cards[0].bottom <= cards[1].top || cards[1].bottom <= cards[0].top || cards[0].right <= cards[1].left || cards[1].right <= cards[0].left)
  })).toBe(true)
  await drag(page, dockPort(page, "internet"), page.getByRole("button", { name: "Connect capabilities to Second", exact: true }))
  await expect(page.getByRole("button", { name: "Detach Internet access from Second", exact: true })).toBeVisible()
})

test("MicroVM creation sliders use GB and keep the resource range ordered", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  await dialog.getByText("MicroVM", { exact: true }).click()
  await dialog.getByPlaceholder("Ubuntu Development").fill("Micro memory")
  const minimum = dialog.getByRole("slider", { name: "Memory minimum", exact: true })
  await expect(minimum).toHaveValue("1")
  const preferred = dialog.getByRole("slider", { name: "Memory preferred", exact: true })
  const maximum = dialog.getByRole("slider", { name: "Memory maximum", exact: true })
  await expect(preferred).toHaveValue("1")
  await expect(maximum).toHaveValue("2")
  await expect(dialog.getByRole("slider")).toHaveCount(7)
  await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
  await preferred.focus()
  await preferred.press("ArrowRight")
  await expect(preferred).toHaveValue("1.125")
  await preferred.press("ArrowRight")
  await preferred.press("ArrowRight")
  await preferred.press("ArrowRight")
  await expect(preferred).toHaveValue("1.5")
  await expect(preferred).toHaveAttribute("aria-valuetext", "1.5 GB")
  await expect(maximum).toHaveValue("2")
  const create = dialog.getByRole("button", { name: "Create environment", exact: true })
  await maximum.focus()
  await maximum.press("ArrowRight")
  await maximum.press("ArrowRight")
  await expect(maximum).toHaveValue("2.25")
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.getByRole("button", { name: "Connect capabilities to Micro memory", exact: true })).toBeVisible()
  const policy = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0].resourcePolicy)
  expect(policy.memoryGb).toMatchObject({ min: 1, preferred: 1.5, max: 2.25 })
  expect(policy.dynamic).toBe(true)
})

test("creation has a compact header, wide layout, and usable sliders on small screens", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  await expect(dialog.getByRole("region", { name: "Connections after creation", exact: true })).toHaveCount(0)
  await expect(dialog.getByText("All disconnected", { exact: true })).toHaveCount(0)
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1024, height: 720 }, { width: 390, height: 700 }, { width: 360, height: 640 }, { width: 800, height: 400 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(async () => dialog.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.width >= innerWidth - 40 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
    })).toBe(true)
    expect((await dialog.locator('[data-slot="dialog-header"]').boundingBox())!.height).toBeLessThan(60)
    const types = dialog.getByRole("radiogroup", { name: "Environment type", exact: true })
    await expect(types.locator(".creation-type")).toHaveCount(5)
    for (const name of ["Container", "GPU", "MicroVM", "VM"]) await expect(types.getByRole("radio", { name, exact: true })).toHaveCount(1)
    await expect(types.getByRole("radio", { name: /Computer branch/ })).toBeDisabled()
    expect(await types.evaluate(element => {
      const positions = Array.from(element.querySelectorAll(".creation-type")).map(item => {
        const rect = item.getBoundingClientRect()
        return rect.top + rect.height / 2
      })
      return Math.max(...positions) - Math.min(...positions) < 1
    })).toBe(true)
    await types.locator(".creation-type").last().scrollIntoViewIfNeeded()
    await expect(types.getByText("Unavailable", { exact: true })).toBeInViewport()
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
    await expect(dialog.getByRole("slider")).toHaveCount(7)
    const slider = dialog.getByRole("slider", { name: "Memory preferred", exact: true })
    await slider.scrollIntoViewIfNeeded()
    const bounds = (await slider.boundingBox())!
    expect(bounds.width).toBeGreaterThan(80)
    await slider.click({ position: { x: bounds.width * 0.75, y: bounds.height / 2 } })
    expect(Number(await slider.inputValue())).toBeGreaterThan(0.25)
    const priorities = dialog.getByRole("radiogroup", { name: "Resource priority", exact: true })
    await expect(priorities.getByRole("radio")).toHaveCount(4)
    expect(await priorities.locator(".creation-priority-option").evaluateAll(options => options.every(option => {
      const text = Array.from(option.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      if (!text) return false
      const range = document.createRange()
      range.selectNodeContents(text)
      const label = range.getBoundingClientRect(), button = option.getBoundingClientRect()
      return Math.abs(label.left + label.width / 2 - button.left - button.width / 2) < 1
        && Math.abs(label.top + label.height / 2 - button.top - button.height / 2) < 2
    }))).toBe(true)
    expect(await priorities.evaluate(element => {
      const centers = Array.from(element.querySelectorAll(".creation-priority-option")).map(item => {
        const rect = item.getBoundingClientRect()
        return rect.top + rect.height / 2
      })
      return Math.max(...centers) - Math.min(...centers) < 1
    })).toBe(true)
    await priorities.getByText("High", { exact: true }).click()
    await expect(priorities.getByRole("radio", { name: "High", exact: true })).toBeChecked()
    await priorities.getByRole("radio", { name: "High", exact: true }).press("ArrowRight")
    await expect(priorities.getByRole("radio", { name: "Critical", exact: true })).toBeChecked()
    const create = (await dialog.getByRole("button", { name: "Create environment", exact: true }).boundingBox())!
    expect(create.y + create.height).toBeLessThan(viewport.height)
    expect(create.x).toBeGreaterThanOrEqual(0)
    expect(await dialog.evaluate(element => Array.from(element.querySelectorAll('[data-slot="scroll-area-viewport"]')).every(viewport => viewport.scrollWidth <= viewport.clientWidth + 1))).toBe(true)
  }
})

test("creation sliders adjust adjacent bounds and reset correctly when isolation changes", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  const minimum = dialog.getByRole("slider", { name: "Memory minimum", exact: true })
  const preferred = dialog.getByRole("slider", { name: "Memory preferred", exact: true })
  const maximum = dialog.getByRole("slider", { name: "Memory maximum", exact: true })
  for (const [kind, floor] of [["MicroVM", "1"], ["VM", "1"], ["Container", "0.5"]] as const) {
    await dialog.getByText(kind, { exact: true }).click()
    for (const slider of [minimum, preferred, maximum]) {
      await expect(slider).toHaveAttribute("min", floor)
      await expect(slider).toHaveAttribute("max", "16")
    }
    for (const name of ["CPU minimum", "CPU preferred", "CPU maximum"]) {
      await expect(dialog.getByRole("slider", { name, exact: true })).toHaveAttribute("max", "8")
    }
  }
  await minimum.focus()
  await minimum.press("End")
  for (const slider of [minimum, preferred, maximum]) await expect(slider).toHaveValue("16")
  await expect(dialog.getByText(/planned container runtime upgrade/)).toHaveCount(0)
  await maximum.focus()
  await maximum.press("Home")
  for (const slider of [minimum, preferred, maximum]) await expect(slider).toHaveValue("0.5")
  await expect(dialog.getByRole("note")).toHaveCount(0)
  await dialog.getByText("VM", { exact: true }).click()
  await expect(preferred).toHaveValue("4")
  await expect(minimum).toHaveAttribute("min", "1")
  await expect(maximum).toHaveAttribute("max", "16")
  await dialog.getByText("Container", { exact: true }).click()
  await expect(preferred).toHaveValue("0.5")
  await expect(maximum).toHaveAttribute("max", "16")
  await dialog.getByRole("button", { name: "Database", exact: true }).click()
  await expect(preferred).toHaveValue("0.5")
  await expect(dialog.getByRole("textbox", { name: "Startup command (optional)", exact: true })).toHaveValue("")
})

for (const theme of ["light", "dark"]) {
  test(`creation workbench keeps readable controls and a live summary in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openGraph(page, [])
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
    await page.getByRole("button", { name: "New environment", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
    const name = dialog.getByRole("textbox", { name: "Name", exact: true })
    await name.fill("Research workspace")
    const summary = dialog.getByLabel("Startup summary", { exact: true })
    await expect(summary).toContainText("Research workspace")
    const preferred = dialog.getByRole("slider", { name: "Memory preferred", exact: true })
    await preferred.focus()
    await preferred.press("ArrowRight")
    await expect(summary).toContainText("0.625 GB")
    expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    const configuration = (await dialog.getByRole("region", { name: "Environment configuration", exact: true }).boundingBox())!
    const resources = (await dialog.getByRole("region", { name: "Resource allocation", exact: true }).boundingBox())!
    expect(resources.x).toBeGreaterThanOrEqual(configuration.x + configuration.width - 1)
    expect((await preferred.boundingBox())!.width).toBeGreaterThan(resources.width * 0.75)
    const contrast = await dialog.locator(".creation-resource-note").first().evaluate(element => {
      const foreground = getComputedStyle(element).color
      const background = getComputedStyle(element.closest(".creation-resources")!).backgroundColor
      const luminance = (color: string) => {
        const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
          const channel = Number(value) / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return r! * 0.2126 + g! * 0.7152 + b! * 0.0722
      }
      const a = luminance(foreground), b = luminance(background)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    await name.fill("A very long environment name ".repeat(2))
    await expect(dialog.getByRole("button", { name: "Create environment", exact: true })).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  })
}

test("creation locks controls while pending and retains the draft after a failed start", async ({ page }) => {
  await openGraph(page, [])
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts"
    const { platformApi } = await import(url)
    const original = platformApi.createEnvironment
    platformApi.createEnvironment = async () => {
      try {
        await new Promise((_, reject) => window.addEventListener("fail-create", () => reject(new Error("Unable to prepare this image")), { once: true }))
      } finally { platformApi.createEnvironment = original }
    }
  })
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Retry workspace")
  await dialog.getByRole("button", { name: "SaaS", exact: true }).click()
  await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("slider", { name: "Memory preferred", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("radio", { name: "MicroVM", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("combobox", { name: "OCI image", exact: true })).toBeDisabled()
  for (const purpose of await dialog.getByRole("group", { name: "What are you building?", exact: true }).getByRole("button").all()) {
    await expect(purpose).toBeDisabled()
  }
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("fail-create")))
  await expect(dialog.getByRole("alert")).toHaveText("Unable to prepare this image")
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Retry workspace")
  await expect(dialog.getByRole("combobox", { name: "OCI image", exact: true })).toContainText("node:slim")
  await expect(dialog.getByRole("button", { name: "SaaS", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(dialog.getByRole("slider", { name: "Memory preferred", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Connect capabilities to Retry workspace", exact: true })).toBeVisible()
})

for (const fails of [false, true]) {
  test(`VM creation leaves the popup and keeps its node through ${fails ? "failure" : "completion"}`, async ({ page }) => {
    await openGraph(page, [])
    await page.evaluate(async fails => {
      const url = "/src/api/platform-api.ts", { platformApi } = await import(url)
      const original = platformApi.createEnvironment
      platformApi.createEnvironment = async (request: Parameters<typeof original>[0]) => {
        if (request.kind !== "fullVm") return original(request)
        const pending = await original(request)
        const environment = pending.environments.find((item: Environment) => item.name === request.name)!
        environment.status = "provisioning"
        localStorage.setItem("opendock.platform.v1", JSON.stringify(pending))
        await new Promise(resolve => window.addEventListener("finish-vm-creation", resolve, { once: true }))
        platformApi.createEnvironment = original
        const finished = JSON.parse(localStorage.getItem("opendock.platform.v1")!) as PlatformState
        const node = finished.environments.find(item => item.id === environment.id)!
        node.status = fails ? "error" : "stopped"
        if (fails) node.lastError = "VM preparation failed: Disk is full. Delete this node and create the VM again."
        localStorage.setItem("opendock.platform.v1", JSON.stringify(finished))
        if (fails) throw new Error(node.lastError)
        return finished
      }
    }, fails)
    await page.getByRole("button", { name: "New environment", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
    await dialog.getByText("VM", { exact: true }).click()
    await expect(dialog.getByText("Full OS", { exact: true })).toHaveCount(0)
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Background VM")
    await dialog.getByRole("textbox", { name: "Installer ISO or virtual disk", exact: true }).fill("C:\\test\\installer.iso")
    await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const node = page.locator("[data-environment-id]").filter({ hasText: "Background VM" })
    await expect(node).toBeVisible()
    const id = await node.getAttribute("data-environment-id")
    await expect(node).toHaveAttribute("aria-busy", "true")
    await expect(node.getByRole("button", { name: "Creating…", exact: true })).toBeDisabled()
    await expect(node.getByRole("button", { name: "Creating…", exact: true }).locator(".animate-spin")).toBeVisible()
    await expect(node.getByRole("button", { name: "Shut down Background VM", exact: true })).toBeDisabled()
    // Inspecting the pending node must not trap the user in another popup.
    await node.getByRole("button", { name: "Configure Background VM", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Background VM", exact: true })
    await expect(sheet.getByRole("button", { name: "Open", exact: true })).toBeDisabled()
    await sheet.getByRole("button", { name: "Close", exact: true }).click()
    // Completing the old request must not close or clear a newly opened form.
    await page.getByRole("button", { name: "New environment", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Keep my next draft")
    await page.evaluate(() => window.dispatchEvent(new Event("finish-vm-creation")))
    await expect(node).toHaveAttribute("aria-busy", "false")
    await expect(node).toHaveAttribute("data-environment-id", id!)
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Keep my next draft")
    await expect(dialog.getByRole("alert")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(node.getByRole("button", { name: "Start", exact: true })).toBeEnabled()
    if (fails) {
      await node.getByRole("button", { name: "Configure Background VM", exact: true }).click()
      await expect(sheet.getByLabel("Environment needs attention")).toContainText("Disk is full")
      await expect(sheet.getByRole("button", { name: "Retry Start", exact: true })).toBeEnabled()
    } else {
      await expect(node).toContainText("Stopped")
    }
    expect(await page.locator("[data-environment-id]").count()).toBe(1)
  })
}

test("resource drafts survive telemetry, show save failures and preserve MicroVM boot RAM", async ({ page }) => {
  await page.clock.install()
  const env = fixture("Micro", "microVm")
  env.status = "running"
  env.resourcePolicy.cpu = { min: 1, preferred: 1, max: 2, current: 1 }
  env.resourcePolicy.memoryGb.current = 0.25
  env.resourcePolicy.dynamic = true
  await openGraph(page, [env])
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts"
    const { platformApi } = await import(url)
    const refresh = platformApi.refreshHostMetrics
    platformApi.refreshHostMetrics = async () => {
      const state = await refresh()
      document.documentElement.setAttribute("data-resource-poll", "done")
      return state
    }
    const save = platformApi.updateResourcePolicy
    platformApi.updateResourcePolicy = async () => {
      platformApi.updateResourcePolicy = save
      throw new Error("Resource save test failure")
    }
  })
  await page.getByRole("button", { name: "Configure Micro", exact: true }).click()
  await page.getByRole("tab", { name: "Resources", exact: true }).click()
  await page.getByRole("button", { name: "Exact values", exact: true }).click()
  const preferred = page.getByRole("spinbutton", { name: "Preferred (GB)", exact: true })
  await preferred.fill("0.375")
  await page.clock.fastForward(12_500)
  await expect(page.locator("html")).toHaveAttribute("data-resource-poll", "done")
  await expect(preferred).toHaveValue("0.375")
  await expect(page.getByText("Restart required for memory:", { exact: false })).toContainText("running with 0.25 GB; next boot uses 0.375 GB")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Resource save test failure" }).first()).toBeVisible()
  await expect(preferred).toHaveValue("0.375")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByText("Resource policy saved.", { exact: true })).toBeVisible()
  const policy = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0].resourcePolicy)
  expect(policy.memoryGb.preferred).toBe(0.375)
  expect(policy.memoryGb.current).toBe(0.25)
  expect(policy.dynamic).toBe(true)
})

test("MongoDB uses its service entrypoint while Linux keeps a terminal alive", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  const command = dialog.getByRole("textbox", { name: "Startup command (optional)", exact: true })
  await expect(command).toHaveValue("sleep 2147483647")
  await dialog.getByRole("combobox", { name: "OCI image", exact: true }).click()
  await page.getByRole("combobox", { name: "Search OCI images", exact: true }).fill("MongoDB")
  await page.getByRole("option").filter({ hasText: "MongoDB" }).click()
  await expect(command).toHaveValue("")
  await dialog.getByPlaceholder("Ubuntu Development").fill("Mongo test")
  await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
  await expect(page.getByRole("button", { name: "Connect capabilities to Mongo test", exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0])
  expect(saved.containerCommand).toBe("")
  expect(saved.resourcePolicy.memoryGb.preferred).toBe(0.5)
})

test("container purpose shortcuts select base images and preserve the rest of the draft", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  const purposes = dialog.getByRole("group", { name: "What are you building?", exact: true })
  const image = dialog.getByRole("combobox", { name: "OCI image", exact: true })
  const command = dialog.getByRole("textbox", { name: "Startup command (optional)", exact: true })
  await expect(dialog.getByText("Quick start", { exact: true })).toHaveCount(0)
  await expect(purposes.getByRole("button")).toHaveCount(6)
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("My project")
  await dialog.getByRole("textbox", { name: "Description optional", exact: true }).fill("Keep my notes")
  for (const [purpose, reference, startup] of [
    ["Website", "node:alpine", "sleep 2147483647"],
    ["SaaS", "node:slim", "sleep 2147483647"],
    ["Database", "mongo:latest", ""],
    ["API", "python:slim", "sleep 2147483647"],
    ["Static site", "nginx:alpine", ""],
    ["Automation", "python:alpine", "sleep 2147483647"],
  ]) {
    await purposes.getByRole("button", { name: purpose, exact: true }).click()
    await expect(image).toContainText(`docker.io/library/${reference}`)
    await expect(command).toHaveValue(startup)
    await expect(purposes.locator('[aria-pressed="true"]')).toHaveText(purpose)
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("My project")
    await expect(dialog.getByRole("textbox", { name: "Description optional", exact: true })).toHaveValue("Keep my notes")
  }
  await purposes.getByRole("button", { name: "Database", exact: true }).click()
  await dialog.getByText("MicroVM", { exact: true }).click()
  await expect(purposes).toHaveCount(0)
  await dialog.getByText("Container", { exact: true }).click()
  await expect(image).toContainText("docker.io/library/alpine:3.24")
  await expect(command).toHaveValue("sleep 2147483647")
  await expect(purposes.locator('[aria-pressed="true"]')).toHaveCount(0)
  await purposes.getByRole("button", { name: "SaaS", exact: true }).click()
  await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0])
  expect(saved.runtime).toBe("docker.io/library/node:slim")
  expect(saved.containerCommand).toBe("sleep 2147483647")
  expect(saved.description).toBe("Keep my notes")
  expect(saved.networkAccess).toBe(false)
  expect(saved.gpuAccess).toBe(false)
  expect(saved.resourcePolicy.dynamic).toBe(true)
})

test("OCI image search opens focused, filters by purpose and registry, and supports keyboard selection", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  const trigger = dialog.getByRole("combobox", { name: "OCI image", exact: true })
  const search = page.getByRole("combobox", { name: "Search OCI images", exact: true })
  await dialog.getByRole("button", { name: "Website", exact: true }).click()
  await trigger.click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await expect(page.locator('[data-slot="combobox-group-label"]')).toHaveText([
    "Operating systems", "Languages", "Web servers", "Data services", "Developer tools",
  ])
  const nameBounds = await dialog.locator(".creation-name").boundingBox()
  const triggerBounds = await trigger.boundingBox()
  const popupBounds = await page.locator(".creation-image-popup").boundingBox()
  expect(nameBounds).not.toBeNull()
  expect(triggerBounds).not.toBeNull()
  expect(popupBounds).not.toBeNull()
  expect(Math.abs(triggerBounds!.width - nameBounds!.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(popupBounds!.width - nameBounds!.width)).toBeLessThanOrEqual(2)
  await expect(page.getByRole("group", { name: "Operating systems", exact: true }).getByRole("option")).toHaveCount(19)
  await expect(page.getByRole("group", { name: "Languages", exact: true }).getByRole("option")).toHaveCount(19)
  await search.fill("  NoDe  docker hub  ")
  await expect(page.getByRole("option")).toHaveCount(2)
  await expect(page.locator('[data-slot="combobox-group-label"]')).toHaveText(["Languages"])
  await search.fill("next.js")
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option")).toContainText("Node.js Slim")
  await search.press("Escape")
  await expect(search).not.toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(trigger).toContainText("node:alpine")
  await expect(dialog.getByRole("button", { name: "Website", exact: true })).toHaveAttribute("aria-pressed", "true")
  await trigger.press("ArrowDown")
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option").filter({ hasText: "Custom image" })).toHaveCount(1)
  await search.fill("postgres")
  await expect(page.getByRole("option")).toHaveCount(1)
  await search.press("ArrowDown")
  await search.press("Enter")
  await expect(search).not.toBeVisible()
  await expect(trigger).toContainText("postgres:latest")
  await expect(dialog.locator('.creation-purpose[aria-pressed="true"]')).toHaveCount(0)
  await expect(dialog.getByRole("textbox", { name: "Startup command (optional)", exact: true })).toHaveValue("")
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments)).toHaveLength(0)
})

test("OCI image search has a usable no-results custom reference path", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  const trigger = dialog.getByRole("combobox", { name: "OCI image", exact: true })
  await trigger.click()
  await page.getByRole("combobox", { name: "Search OCI images", exact: true }).fill("nonexistent-test-image-xyz")
  await expect(page.getByRole("option")).toHaveCount(0)
  await expect(page.getByText(/No matching images in the catalog/)).toBeVisible()
  await page.getByRole("button", { name: "Use custom image", exact: true }).click()
  const custom = dialog.getByRole("textbox", { name: "Custom OCI image reference", exact: true })
  await expect(custom).toBeVisible()
  await expect(custom).toHaveValue("")
  await expect(trigger).toContainText("Custom image")
  const reference = "registry.example.test/team/my-app:v1.2.3"
  await custom.fill(reference)
  await trigger.click()
  await expect(page.getByRole("combobox", { name: "Search OCI images", exact: true })).toHaveValue("")
  await page.keyboard.press("Escape")
  await expect(custom).toHaveValue(reference)
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Custom project")
  await dialog.getByRole("button", { name: "Create environment", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.platform.v1")!).environments[0])
  expect(saved.runtime).toBe(reference)
  expect(saved.containerCommand).toBe("")
})

test("OCI image picker stays inside the viewport with readable results in both themes", async ({ page }) => {
  await openGraph(page, [])
  await page.getByRole("button", { name: "New environment", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New environment", exact: true })
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
    for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 650 }, { width: 390, height: 650 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport)
      await dialog.getByRole("combobox", { name: "OCI image", exact: true }).click()
      const search = page.getByRole("combobox", { name: "Search OCI images", exact: true })
      await expect(search).toBeFocused()
      const popup = page.locator(".creation-image-popup")
      const box = (await popup.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      await expect(search).toBeInViewport()
      await expect(page.getByRole("button", { name: "Use custom image", exact: true })).toBeInViewport()
      expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await search.fill("mcr.microsoft.com")
      await expect(page.getByRole("option")).toHaveCount(4)
      expect(await popup.evaluate(element => [...element.querySelectorAll('[data-slot="scroll-area-viewport"]')].every(viewport => viewport.scrollWidth <= viewport.clientWidth + 1))).toBe(true)
      await search.press("Escape")
      const purposes = dialog.getByRole("group", { name: "What are you building?", exact: true })
      expect(await purposes.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
  }
})

test("failed saves clear the busy state and allow a retry without a phantom wire", async ({ page }) => {
  await openGraph(page, [fixture("Alpha")])
  const statsBeforeError = (await page.getByRole("region", { name: "Host resources and storage" }).boundingBox())!
  const graphBeforeError = (await page.locator("[data-environment-graph]").boundingBox())!
  await page.evaluate(async () => {
    const url = "/src/api/platform-api.ts"
    const { platformApi } = await import(url)
    const original = platformApi.updateContainerNetwork
    platformApi.updateContainerNetwork = async () => {
      try {
        await new Promise((_, reject) => window.addEventListener("fail-graph-save", () => reject(new Error("Test save failed")), { once: true }))
      } finally { platformApi.updateContainerNetwork = original }
    }
  })
  await drag(page, dockPort(page, "internet"), port(page))
  await expect(port(page)).toBeDisabled()
  await expect(page.locator('[data-environment-id="Alpha"]')).toHaveAttribute("aria-busy", "true")
  await expect(line(page, "internet")).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event("fail-graph-save")))
  const error = page.getByRole("alert").filter({ hasText: "Test save failed" })
  await expect(error).toBeVisible()
  await expect(page.locator("[data-environment-graph]").getByRole("alert")).toHaveCount(0)
  const errorBox = (await error.boundingBox())!
  const statsBox = (await page.getByRole("region", { name: "Host resources and storage" }).boundingBox())!
  expect(errorBox.y + errorBox.height).toBeLessThan(statsBox.y)
  const headerBox = (await page.getByRole("banner").boundingBox())!
  const paddingAbove = errorBox.y - (headerBox.y + headerBox.height)
  const paddingBelow = statsBox.y - (errorBox.y + errorBox.height)
  expect(Math.abs(paddingAbove - paddingBelow)).toBeLessThan(1)
  expect(statsBox).toEqual(statsBeforeError)
  expect(await page.locator("[data-environment-graph]").boundingBox()).toEqual(graphBeforeError)
  await error.getByRole("button", { name: "Dismiss graph error" }).click()
  await expect(error).toHaveCount(0)
  await expect(port(page)).toBeEnabled()
  await expect(line(page, "internet")).toHaveCount(0)
  await drag(page, dockPort(page, "internet"), port(page))
  await assertLineAligned(page, "internet")
})

test("an overlapping node receives the drop on the card that is actually on top", async ({ page }) => {
  await openGraph(page)
  const a = await center(page.locator('[data-environment-id="Alpha"] [data-node-drag-grip]'))
  const b = await center(page.locator('[data-environment-id="Beta"] [data-node-drag-grip]'))
  await page.mouse.move(b.x, b.y)
  await page.mouse.down()
  await page.mouse.move(a.x, a.y, { steps: 12 })
  await page.mouse.up()
  await drag(page, dockPort(page, "internet"), port(page, "Beta"))
  await assertLineAligned(page, "internet", "Beta")
  await expect(line(page, "internet", "Alpha")).toHaveCount(0)
})

test("MicroVM apps install on demand, open separate windows, reopen and stop", async ({ page }) => {
  const env = fixture("env-app-launcher", "microVm")
  env.status = "running"
  env.resourcePolicy.memoryGb = { min: 0.5, preferred: 2, max: 2, current: 2 }
  await openGraph(page, [env])
  await page.evaluate(async () => {
    const url = "/src/api/guest-apps-api.ts"
    const { guestAppsApi } = await import(url)
    guestAppsApi.openWindow = async (environmentId: string, sessionId: string) => {
      document.documentElement.setAttribute("data-open-app", `${environmentId}:${sessionId}`)
      return true
    }
    const original = guestAppsApi.install
    guestAppsApi.install = async () => { guestAppsApi.install = original; throw new Error("Test package download failed") }
  })
  await page.getByRole("button", { name: "Configure env-app-launcher", exact: true }).click()
  await page.getByRole("button", { name: "Apps", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Apps · env-app-launcher", exact: true })
  await dialog.getByRole("button", { name: "Graphical terminal", exact: true }).click()
  const launch = dialog.getByRole("button", { name: "Launch in new window", exact: true })
  await expect(launch).toBeDisabled()
  await dialog.getByRole("button", { name: "Install app support", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Test package download failed")
  await dialog.getByRole("button", { name: "Install app support", exact: true }).click()
  await expect(launch).toBeEnabled()
  await launch.click()
  await expect(page.locator("html")).toHaveAttribute("data-open-app", /^env-app-launcher:app-/)
  await expect(dialog.getByRole("region", { name: "App sessions", exact: true })).toContainText("Graphical terminal")
  await page.evaluate(() => document.documentElement.removeAttribute("data-open-app"))
  await dialog.getByRole("button", { name: "Open Graphical terminal window", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-open-app", /^env-app-launcher:app-/)
  await dialog.getByRole("button", { name: "Stop Graphical terminal", exact: true }).click()
  await expect(dialog.getByRole("region", { name: "App sessions", exact: true })).toHaveCount(0)
})

test("MicroVM app launcher requires adequate running memory and keeps Linux limitations visible", async ({ page }) => {
  const env = fixture("env-low-memory", "microVm")
  env.status = "running"
  env.resourcePolicy.memoryGb.current = 0.25
  await openGraph(page, [env])
  await page.getByRole("button", { name: "Configure env-low-memory", exact: true }).click()
  await page.getByRole("button", { name: "Apps", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Apps · env-low-memory", exact: true })
  await expect(dialog).toContainText("running with 0.25 GB")
  await expect(dialog).toContainText("Windows .exe files and incompatible Linux builds will not work")
  await expect(dialog.getByRole("button", { name: "Launch in new window", exact: true })).toBeDisabled()
  await expect(dialog).not.toContainText("MiB")
})

test("removed PC Apps entry is not offered in the toolbar", async ({ page }) => {
  await openGraph(page, [])
  await expect(page.getByRole("banner").getByRole("button", { name: "Apps from your PC", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New environment", exact: true })).toBeVisible()
})

test("Cloudflare account authentication is optional and quick links never read saved credentials", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await seedServices(page); await openGraph(page, [env])
  await page.evaluate(async () => {
    const url = "/src/api/workspace-api.ts", { workspaceApi } = await import(url)
    workspaceApi.savedCloudflare = async () => { throw new Error("Vault must not be queried for a Quick Tunnel") }
    const original = workspaceApi.publish
    workspaceApi.publish = (...args: Parameters<typeof original>) => {
      if (args[4] !== undefined) throw new Error("Quick link received account credentials")
      return original(...args)
    }
  })
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("radio", { name: "Public access / Cloudflare Tunnel", exact: true }).check()
  await expect(dialog.getByRole("radio", { name: "Quick link — no account", exact: true })).toBeChecked()
  await expect(dialog.getByLabel("Tunnel token", { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "https://test-tunnel.example.test", exact: true })).toBeVisible()
})

test("Cloudflare account tokens stay masked, authenticate optionally, and can be forgotten", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await seedServices(page); await openGraph(page, [env])
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("radio", { name: "Public access / Cloudflare Tunnel", exact: true }).check()
  await dialog.getByRole("radio", { name: "Use my Cloudflare account (optional)", exact: true }).check()
  await expect(dialog).toContainText("free and paid Cloudflare accounts")
  await expect(dialog).toContainText("Account authentication does not make visitors log in")
  const token = dialog.getByLabel("Tunnel token", { exact: true })
  await expect(token).toHaveAttribute("type", "password")
  await expect(dialog.getByRole("checkbox", { name: "Remember in this PC’s credential vault", exact: true })).not.toBeChecked()
  await dialog.getByLabel("Public hostname", { exact: true }).fill("app.example.com")
  await dialog.getByLabel("Local tunnel port", { exact: true }).fill("45000")
  await expect(dialog.getByLabel("Cloudflare service URL", { exact: true })).toHaveText("http://127.0.0.1:45000")
  await token.fill("fake-test-only-token")
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Review the dedicated tunnel")
  await expect(dialog.getByRole("button", { name: "Disconnect cloudflare from port 4200", exact: true })).toHaveCount(0)
  await dialog.getByRole("checkbox", { name: "I reviewed this dedicated tunnel’s routes", exact: true }).check()
  await dialog.getByRole("checkbox", { name: "Remember in this PC’s credential vault", exact: true }).check()
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "https://app.example.com", exact: true })).toBeVisible()
  await expect(token).toHaveValue("")
  await expect(dialog.getByRole("button", { name: "Forget saved token", exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fake-test-only-token")
  await dialog.getByRole("button", { name: "Disconnect cloudflare from port 4200", exact: true }).click()
  await dialog.getByRole("button", { name: "Done", exact: true }).click()
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  await dialog.getByRole("radio", { name: "Public access / Cloudflare Tunnel", exact: true }).check()
  await expect(dialog.getByRole("radio", { name: "Quick link — no account", exact: true })).toBeChecked()
  await dialog.getByRole("radio", { name: "Use my Cloudflare account (optional)", exact: true }).check()
  await expect(dialog.getByLabel("Public hostname", { exact: true })).toHaveValue("app.example.com")
  await expect(token).toHaveValue("")
  await dialog.getByRole("checkbox", { name: "I reviewed this dedicated tunnel’s routes", exact: true }).check()
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "https://app.example.com", exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Forget saved token", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Forget saved token", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Disconnect cloudflare from port 4200", exact: true })).toBeVisible()
})

test("Cloudflare account failure allows retry without an anonymous fallback or exposing the token", async ({ page }) => {
  const env = fixture("Alpha"); env.status = "running"
  await seedServices(page); await openGraph(page, [env])
  await page.evaluate(async () => {
    const url = "/src/api/workspace-api.ts", { workspaceApi } = await import(url)
    const original = workspaceApi.publish
    workspaceApi.publish = async () => { workspaceApi.publish = original; throw new Error("Cloudflare rejected authentication. Check the token.") }
  })
  await page.getByRole("button", { name: "Port 4200 in Alpha", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("radio", { name: "Public access / Cloudflare Tunnel", exact: true }).check()
  await dialog.getByRole("radio", { name: "Use my Cloudflare account (optional)", exact: true }).check()
  await dialog.getByLabel("Public hostname", { exact: true }).fill("app.example.com")
  await dialog.getByLabel("Local tunnel port", { exact: true }).fill("45000")
  await dialog.getByLabel("Tunnel token", { exact: true }).fill("fake-test-only-token")
  await dialog.getByRole("checkbox", { name: "I reviewed this dedicated tunnel’s routes", exact: true }).check()
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("rejected authentication")
  await expect(dialog.getByRole("button", { name: "Disconnect cloudflare from port 4200", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Publish service", exact: true })).toBeEnabled()
  await expect(dialog.getByRole("radio", { name: "Use my Cloudflare account (optional)", exact: true })).toBeChecked()
  await dialog.getByRole("button", { name: "Publish service", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "https://app.example.com", exact: true })).toBeVisible()
})
