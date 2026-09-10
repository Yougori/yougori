param(
    [ValidateRange(1, 65535)]
    [int]$Port = 1420,
    [switch]$CheckDesktopOnly
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

if ($CheckDesktopOnly) {
    # The native singleton is local to this Windows session. Include headless
    # engines: a missing dashboard or Vite listener does not mean they exited.
    $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $desktops = @(Get-Process -Name yougori -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sessionId })
    if ($desktops.Count -gt 0) {
        $desktopIds = ($desktops | Select-Object -ExpandProperty Id) -join ', '
        throw "Yougori is already running (PID $desktopIds). Exit the existing app completely before running npm run desktop:dev. For a background engine, use .\src-tauri\resources\cli\yougori-cli.exe app quit --yes (this also stops its workloads). This launch has not started or stopped any app or development server."
    }
    return
}

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)

function Find-WorkspaceTauriAncestor([int]$ProcessId) {
    $visited = @{}
    while ($ProcessId -gt 0 -and -not $visited.ContainsKey($ProcessId)) {
        $visited[$ProcessId] = $true
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $candidate) { return $null }
        $candidateCommand = [string]$candidate.CommandLine
        if (
            $candidate.Name -ieq 'node.exe' -and
            $candidateCommand.IndexOf($workspace, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $candidateCommand -match '(?i)[\\/]@tauri-apps[\\/]cli[\\/]tauri\.js["'']?\s+dev(?:\s|$)'
        ) {
            return [int]$candidate.ProcessId
        }
        $ProcessId = [int]$candidate.ParentProcessId
    }
    return $null
}

foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    $commandLine = [string]$process.CommandLine
    $isThisWorkspaceVite =
        $process.Name -ieq 'node.exe' -and
        $commandLine.IndexOf($workspace, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine -match '(?i)[\\/]vite[\\/]bin[\\/]vite\.js'

    if (-not $isThisWorkspaceVite) {
        throw "Development port $Port is already owned by PID $processId ($($process.Name)). Stop that process or choose a different port."
    }

    $tauriProcessId = Find-WorkspaceTauriAncestor $processId
    if ($null -ne $tauriProcessId) {
        # A live Tauri parent may own guests writing to disks. A port conflict
        # cannot establish that the desktop is stale: never kill its process tree.
        throw "Yougori development is already running on port $Port (Tauri PID $tauriProcessId). Close that desktop normally before starting another session; its environments were not stopped."
    } else {
        Write-Host "Stopping stale Yougori Vite server on port $Port (PID $processId)..."
        Stop-Process -Id $processId -Force
    }
}

$portReleased = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        $portReleased = $true
        break
    }
    Start-Sleep -Milliseconds 100
}
if (-not $portReleased) {
    throw "Development port $Port is still in use after stale-server cleanup."
}
