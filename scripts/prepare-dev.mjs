import { spawnSync } from "node:child_process"

// Check the desktop before Tauri starts Vite. A duplicate native launch exits,
// which also stops Tauri's Vite child and leaves an existing dev window offline.
// The ordinary predev hook still handles only stale-port recovery.
if (process.platform === "win32") {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/ensure-dev-port.ps1"]
  if (process.argv.includes("--desktop")) args.push("-CheckDesktopOnly")
  const result = spawnSync("powershell", args, { stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
