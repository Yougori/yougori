import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { checkedFile, checkCompliance } from "./compliance-check.mjs"

const hash = value => createHash("sha256").update(value).digest("hex")

async function fixture(t) {
  const parent = resolve(tmpdir())
  const root = await mkdtemp(join(parent, "yougori-compliance-test-"))
  t.after(async () => {
    // Delete only this explicitly created temporary fixture directory.
    assert.equal(dirname(resolve(root)), parent)
    assert.ok(root.startsWith(join(parent, "yougori-compliance-test-")))
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, "src-tauri/resources/runtime"), { recursive: true })
  await mkdir(join(root, "compliance"))
  await mkdir(join(root, "build/compliance/bundle"), { recursive: true })
  await writeFile(join(root, "src-tauri/resources/runtime/guest.bin"), "runtime-v1")
  await writeFile(join(root, "build/compliance/bundle/source.tar.gz"), "source-v1")
  const report = {
    schemaVersion: 1,
    inputs: [{ path: "src-tauri/resources/runtime/guest.bin", sha256: hash("runtime-v1") }],
    archives: [{ file: "source.tar.gz", sha256: hash("source-v1") }],
    blockers: [],
    review: { status: "approved", reviewer: "fixture", date: "2026-09-13", evidence: "fixture-only" },
    publication: { status: "verified", manifestUrl: "https://example.invalid/source", verifiedAt: "2026-09-13", evidence: "fixture-only" },
  }
  const save = () => writeFile(join(root, "compliance/release.json"), JSON.stringify(report))
  await save()
  return { root, report, save }
}

test("a complete fixture passes; a changed runtime requires new source review", async t => {
  const { root } = await fixture(t)
  assert.equal((await checkCompliance(root, { distribution: true })).distributionReady, true)
  await writeFile(join(root, "src-tauri/resources/runtime/guest.bin"), "runtime-v2")
  await assert.rejects(checkCompliance(root, { distribution: true }), /material changed/)
})

test("local packages can be prepared before publishing their matching sources", async t => {
  const { root, report, save } = await fixture(t)
  report.publication = { status: "not-published" }
  await save()
  assert.equal((await checkCompliance(root, { packaging: true })).packagingReady, true)
  await assert.rejects(checkCompliance(root, { distribution: true }), /not been published/)
  report.blockers.push({ id: "missing-source" })
  await save()
  await assert.rejects(checkCompliance(root, { packaging: true }), /Packaging blocked/)
})

test("new runtime files cannot evade the inventory", async t => {
  const { root } = await fixture(t)
  await writeFile(join(root, "src-tauri/resources/runtime/new-library.dll"), "new")
  await assert.rejects(checkCompliance(root), /files were added or removed/)
})

test("Git newline conversion is accepted for text inputs, never runtime binaries", async t => {
  const { root, report, save } = await fixture(t)
  await writeFile(join(root, "LICENSE"), "license\r\nnotice\r\n")
  report.inputs.push({ path: "LICENSE", sha256: hash("license\nnotice\n"), normalization: "lf" })
  await save()
  await checkCompliance(root)
  await writeFile(join(root, "LICENSE"), "license\nchanged notice\n")
  await assert.rejects(checkCompliance(root), /material changed/)
  report.inputs[0].normalization = "lf"
  await save()
  await assert.rejects(checkCompliance(root), /must cover raw bytes/)
})

test("collected sources do not override an unresolved finding", async t => {
  const { root, report, save } = await fixture(t)
  report.blockers.push({ id: "missing-upstream-source", reason: "fixture" })
  await save()
  assert.equal((await checkCompliance(root)).blockers, 1)
  await assert.rejects(checkCompliance(root, { distribution: true }), /Packaging blocked/)
})

test("a missing or altered source archive blocks packaging", async t => {
  const { root } = await fixture(t)
  const path = join(root, "build/compliance/bundle/source.tar.gz")
  await writeFile(path, "wrong-source")
  await assert.rejects(checkCompliance(root, { distribution: true }), /material changed/)
  await rm(path)
  await assert.rejects(checkCompliance(root, { distribution: true }), /ENOENT/)
})

test("review and publication must be recorded, not inferred from an empty blocker list", async t => {
  const { root, report, save } = await fixture(t)
  report.review.status = "pending"
  await save()
  await assert.rejects(checkCompliance(root, { distribution: true }), /Packaging blocked/)
  report.review.status = "approved"
  delete report.review.evidence
  await save()
  await assert.rejects(checkCompliance(root, { distribution: true }), /recorded source\/license review/)
  report.review.evidence = "fixture"
  report.publication.status = "not-published"
  await save()
  await assert.rejects(checkCompliance(root, { distribution: true }), /published and verified/)
})

test("inventory paths reject traversal, Windows streams and duplicate names", async t => {
  const { root, report, save } = await fixture(t)
  for (const path of ["../escape", "C:/escape", "runtime.bin:stream", "x\\y", "/absolute", "a/./b"]) {
    await assert.rejects(checkedFile(root, path), /Unsafe compliance path/)
  }
  report.inputs.push({ ...report.inputs[0] })
  await save()
  await assert.rejects(checkCompliance(root), /Duplicate compliance file/)
})

test("all installer configurations carry Apache attribution and dependency notices", async () => {
  const json = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"))
  assert.equal((await json("package.json")).license, "Apache-2.0")
  assert.equal((await json("package-lock.json")).packages[""].license, "Apache-2.0")
  const base = await json("src-tauri/tauri.conf.json")
  assert.equal(base.bundle.license, "Apache-2.0")
  assert.match(base.build.beforeBuildCommand, /release:package/)
  for (const platform of ["windows", "linux", "macos"]) {
    const { resources } = (await json(`src-tauri/tauri.${platform}.conf.json`)).bundle
    assert.equal(resources["../LICENSE"], "LICENSE")
    assert.equal(resources["../NOTICE"], "NOTICE")
    for (const file of ["APPLICATION_LICENSES.txt", "RUNTIME_LICENSES.txt", "WORKSPACE_LICENSES.txt"]) {
      assert.equal(resources[`resources/${file}`], file)
    }
  }
})
