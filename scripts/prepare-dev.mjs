import { spawnSync } from "node:child_process"

// Windows needs stale-port recovery; Linux uses Vite's strict-port error.
if (process.platform === "win32") {
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/ensure-dev-port.ps1"], { stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
