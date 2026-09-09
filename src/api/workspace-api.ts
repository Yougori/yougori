import { platformApi, run } from "@/api/platform-api"
import type { TerminalInstallerId } from "@/lib/terminal-installers"

export type PublicationKind = "local" | "public" | "cloudflare"
export interface ServicePort { port: number; protocol: string; name: string; address: string }
export interface Publication { id: string; environmentId: string; port: number; kind: PublicationKind; hostPort: number; urls: string[]; status: string; message: string; cloudflareAccount?: boolean }
export interface CloudflareAccountOptions { hostname: string; token?: string; remember: boolean; routesReviewed: boolean }
export interface SavedCloudflareAccount { saved: boolean; hostname: string; hostPort: number | null }
export interface HostShare { id: string; environmentId: string; path: string; readOnly: boolean; mountPath: string | null; guestUrl: string }
export interface EnvironmentServices { services: ServicePort[]; publications: Publication[]; shares: HostShare[]; notice: string }
export interface TerminalOutput { data: string; offset: number; done: boolean }
export interface GuestWindow { label: string; title: string }

const terminalFixtures = new Map<string, { output: string; input: string }>()
const fixtureKey = "opendock.workspace.v1"
// Browser-only test adapter. Never write even fixture secrets into localStorage.
const cloudflareFixtures = new Map<string, SavedCloudflareAccount>()
function readFixtures(): Record<string, EnvironmentServices> { try { return JSON.parse(localStorage.getItem(fixtureKey) ?? "{}") } catch { return {} } }
const empty = (): EnvironmentServices => ({ services: [], publications: [], shares: [], notice: "" })
function fixture(environmentId: string, update?: (state: EnvironmentServices) => void) {
  const all = readFixtures(), state = all[environmentId] ?? empty()
  if (update) { update(state); all[environmentId] = state; localStorage.setItem(fixtureKey, JSON.stringify(all)) }
  return state
}

export const workspaceApi = {
  manualPorts() {
    return run<Record<string, number[]>>("get_manual_service_ports", {}, () => JSON.parse(localStorage.getItem("opendock.workspace.manual.v2") ?? "{}"))
  },
  setManualPort(environmentId: string, port: number, present: boolean) {
    return run<Record<string, number[]>>("set_manual_service_port", { environmentId, port, present }, () => {
      if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 7443) throw new Error("Invalid service port")
      const ports: Record<string, number[]> = JSON.parse(localStorage.getItem("opendock.workspace.manual.v2") ?? "{}")
      ports[environmentId] = present ? [...new Set([...(ports[environmentId] ?? []), port])].sort((a, b) => a - b) : (ports[environmentId] ?? []).filter(p => p !== port)
      localStorage.setItem("opendock.workspace.manual.v2", JSON.stringify(ports))
      return ports
    })
  },
  prepareInstaller(environmentId: string, sessionId: string, tool: TerminalInstallerId) {
    return run<string>("prepare_terminal_installer", { environmentId, sessionId, tool }, () => {
      if (!terminalFixtures.has(sessionId)) throw new Error("The installation terminal is closed")
      return `exec sh '/tmp/opendock-install.${tool}/install.sh'`
    })
  },
  terminal(environmentId: string, sessionId: string, action: "create" | "read" | "write" | "resize" | "close", options: { data?: string; offset?: number; cols?: number; rows?: number } = {}) {
    return run<TerminalOutput>("terminal_action", { environmentId, sessionId, action, ...options }, () => {
      if (action === "create") terminalFixtures.set(sessionId, { output: "Yougori test terminal\r\n$ ", input: "" })
      const terminal = terminalFixtures.get(sessionId)
      if (action === "write" && terminal) {
        const input = atob(options.data ?? ""); terminal.input += input; terminal.output += input
        if (input.includes("\r")) { terminal.output += `\n${terminal.input.replace(/\r/g, "").replace(/^echo /, "")}\r\n$ `; terminal.input = "" }
      }
      if (action === "close") terminalFixtures.delete(sessionId)
      const output = terminal?.output ?? ""
      return { data: btoa(output.slice(options.offset ?? 0)), offset: output.length, done: action === "close" }
    })
  },
  services(environmentId: string) { return run<EnvironmentServices>("list_environment_services", { environmentId }, () => fixture(environmentId)) },
  publish(environmentId: string, port: number, kind: PublicationKind, hostPort?: number, cloudflare?: CloudflareAccountOptions) {
    return run<Publication>("publish_environment_service", { environmentId, port, kind, hostPort, cloudflare }, () => {
      const environment = JSON.parse(localStorage.getItem("opendock.platform.v1") || "{}").environments?.find((e: { id: string }) => e.id === environmentId)
      if (environment?.kind === "cloud") throw new Error("Cloud nodes cannot connect to Local network or Public access.")
      if (cloudflare && (kind !== "cloudflare" || !cloudflare.routesReviewed || !hostPort || !cloudflare.hostname || (!cloudflare.token && !cloudflareFixtures.has(`${environmentId}:${port}`)))) throw new Error("Review the tunnel hostname, token, local port, and dashboard routes.")
      if (cloudflare?.remember) cloudflareFixtures.set(`${environmentId}:${port}`, { saved: true, hostname: cloudflare.hostname, hostPort: hostPort! })
      const value: Publication = { id: `pub-${crypto.randomUUID()}`, environmentId, port, kind, hostPort: hostPort ?? port + 10000, urls: [kind === "cloudflare" ? cloudflare ? `https://${cloudflare.hostname}` : "https://test-tunnel.example.test" : `http://127.0.0.1:${hostPort ?? port + 10000}`], status: "active", message: cloudflare ? "Account tunnel connected. Dashboard routing and visitor authentication are not verified by Yougori." : "Test adapter publication", cloudflareAccount: Boolean(cloudflare) }
      fixture(environmentId, state => state.publications.push(value)); return value
    })
  },
  savedCloudflare(environmentId: string, port: number) { return run<SavedCloudflareAccount>("saved_cloudflare_account", { environmentId, port }, () => cloudflareFixtures.get(`${environmentId}:${port}`) ?? { saved: false, hostname: "", hostPort: null }) },
  forgetCloudflare(environmentId: string, port: number) { return run<void>("forget_cloudflare_account", { environmentId, port }, () => { cloudflareFixtures.delete(`${environmentId}:${port}`) }) },
  unpublish(publicationId: string) { return run<void>("unpublish_environment_service", { publicationId }, () => { for (const id of Object.keys(readFixtures())) fixture(id, state => { state.publications = state.publications.filter(p => p.id !== publicationId) }) }) },
  async chooseFolders(): Promise<string[]> {
    if (!("__TAURI_INTERNALS__" in window)) return run("choose_host_folders", {}, () => ["C:\\Shared project"])
    const { open } = await import("@tauri-apps/plugin-dialog")
    const result = await open({ directory: true, multiple: true, title: "Choose folders to share with this environment" })
    return result ? Array.isArray(result) ? result : [result] : []
  },
  share(environmentId: string, path: string, readOnly: boolean) {
    return run<HostShare>("attach_host_folder", { environmentId, path, readOnly }, async () => {
      const state = await platformApi.getState()
      if (state.environments.find(e => e.id === environmentId)?.kind === "cloud") throw new Error("Cloud nodes use connection-owned shared folders, not direct My PC mounts")
      const id = `share-${crypto.randomUUID()}`; const value = { id, environmentId, path, readOnly, mountPath: `/opendock/shared/my-pc/${id}`, guestUrl: `http://10.0.2.2:12345/test-${id}/` }; fixture(environmentId, state => state.shares.push(value)); return value
    })
  },
  unshare(shareId: string) { return run<void>("detach_host_folder", { shareId }, () => { for (const id of Object.keys(readFixtures())) fixture(id, state => { state.shares = state.shares.filter(s => s.id !== shareId) }) }) },
  windows() { return run<GuestWindow[]>("list_environment_windows", {}, () => []) },
  focusWindow(label: string) { return run<void>("focus_environment_window", { label }, () => undefined) },
  titleWindow(environmentId: string) { return run<void>("title_environment_window", { environmentId }, () => undefined) },
  openUrl(url: string) { return run<void>("open_workspace_url", { url }, () => { window.open(url, "_blank", "noopener,noreferrer") }) },
}
