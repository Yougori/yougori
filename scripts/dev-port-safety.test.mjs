import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

// Mock process/network inspection and termination inside a separate PowerShell.
// These tests never inspect or terminate real listeners, desktops or guests.
function runCase(scenario) {
  const command = `
    $ErrorActionPreference = 'Stop'
    $global:yougoriDevTestListenerQueries = 0
    $global:yougoriDevTestStopped = @()
    function Get-NetTCPConnection {
      param($LocalPort, $State, $ErrorAction)
      $global:yougoriDevTestListenerQueries++
      if ($global:yougoriDevTestListenerQueries -eq 1) { [pscustomobject]@{ OwningProcess = 111 } }
    }
    function Get-CimInstance {
      param($ClassName, $Filter, $ErrorAction)
      if ($Filter -eq 'ProcessId = 111') {
        if ($env:YOUGORI_DEV_TEST_CASE -eq 'unrelated') {
          [pscustomobject]@{ Name='node.exe'; CommandLine='C:\\unrelated\\server.js'; ParentProcessId=0; ProcessId=111 }
        } else {
          [pscustomobject]@{ Name='node.exe'; CommandLine=($env:YOUGORI_DEV_TEST_ROOT + '\\node_modules\\vite\\bin\\vite.js'); ParentProcessId=222; ProcessId=111 }
        }
      } elseif ($Filter -eq 'ProcessId = 222' -and $env:YOUGORI_DEV_TEST_CASE -eq 'active') {
        [pscustomobject]@{ Name='node.exe'; CommandLine=($env:YOUGORI_DEV_TEST_ROOT + '\\node_modules\\@tauri-apps\\cli\\tauri.js dev'); ParentProcessId=0; ProcessId=222 }
      }
    }
    function Stop-Process {
      param($Id, [switch]$Force, $ErrorAction)
      $global:yougoriDevTestStopped += $Id
      if ($env:YOUGORI_DEV_TEST_CASE -ne 'orphan' -or $Id -ne 111) { throw 'UNSAFE_PROCESS_TERMINATION' }
    }
    try { & $env:YOUGORI_DEV_TEST_SCRIPT } catch { Write-Output $_.Exception.Message }
    Write-Output ('STOPPED:' + ($global:yougoriDevTestStopped -join ','))
  `
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true, timeout: 15_000,
    env: {
      ...process.env,
      YOUGORI_DEV_TEST_CASE: scenario,
      YOUGORI_DEV_TEST_ROOT: fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, ""),
      YOUGORI_DEV_TEST_SCRIPT: fileURLToPath(new URL("ensure-dev-port.ps1", import.meta.url)),
    },
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test("a second dev launch does not force-kill a live desktop or its guests", { skip: process.platform !== "win32" }, () => {
  const output = runCase("active")
  assert.match(output, /Close that desktop normally/)
  assert.match(output, /STOPPED:\s*$/)
  assert.doesNotMatch(output, /UNSAFE_PROCESS_TERMINATION/)
})

test("an unrelated process owning the dev port is preserved", { skip: process.platform !== "win32" }, () => {
  const output = runCase("unrelated")
  assert.match(output, /already owned by PID 111/)
  assert.match(output, /STOPPED:\s*$/)
})

test("only an orphaned workspace Vite server is eligible for cleanup", { skip: process.platform !== "win32" }, () => {
  assert.match(runCase("orphan"), /STOPPED:111\s*$/)
})
