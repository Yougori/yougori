import { run } from "./platform-api"
export interface CloudProfile {
  name: string; vendor: "aws" | "google" | "azure" | "other"; host: string; port: number
  username: string; identityFile: string; hostKey: string
}
export interface CloudHostKey { key: string; fingerprint: string }
export const cloudApi = {
  scan(host: string, port: number) {
    return run<CloudHostKey[]>("scan_cloud_host", { host, port }, () => [{ key: "ssh-ed25519 TEST-PREVIEW-ONLY", fingerprint: "SHA256:preview-only-not-a-real-server" }])
  },
  details(environmentId: string) {
    return run<{ profile: CloudProfile; connection: { socksPort: number; filesPort: number } | null }>("get_cloud_connection", { environmentId }, () => ({ profile: JSON.parse(localStorage.getItem(`opendock.cloud.${environmentId}`) || "null") as CloudProfile, connection: { socksPort: 1080, filesPort: 8080 } }))
  },
  async selectKey() {
    if (!("__TAURI_INTERNALS__" in window)) return null
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({ multiple: false, directory: false, title: "Choose SSH identity file" })
    return typeof selected === "string" ? selected : null
  },
}
