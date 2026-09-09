param(
    [Parameter(Mandatory=$true)][string]$DataDirectory,
    [Parameter(Mandatory=$true)][string]$Distribution,
    [switch]$Terminate
)
$ErrorActionPreference = 'Stop'
$dataPath = [IO.Path]::GetFullPath($DataDirectory.Replace('\\?\', '')).TrimEnd('\')
if ([IO.Path]::GetPathRoot($dataPath).TrimEnd('\') -eq $dataPath) { throw 'A dedicated CUDA data directory is required.' }
$sha = [Security.Cryptography.SHA256]::Create()
$digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataPath.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant()
if ($Distribution -cne ('OpenDock-CUDA-' + $digest.Substring(0, 12))) { throw 'CUDA runtime identity mismatch.' }
$registered = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction Stop | Get-ItemProperty | Where-Object { $_.DistributionName -ceq $Distribution })
if ($registered.Count -ne 1 -or $registered[0].Version -ne 2) { throw 'The owned WSL 2 distribution is missing.' }
$basePath = [IO.Path]::GetFullPath($registered[0].BasePath.Replace('\\?\', '')).TrimEnd('\')
$expectedPath = Join-Path $dataPath 'distribution'
if ($basePath -ine $expectedPath) { throw 'This WSL distribution belongs to different storage. It was not touched.' }
if (!(Test-Path -LiteralPath (Join-Path $expectedPath 'ext4.vhdx') -PathType Leaf)) { throw 'The CUDA disk is missing. No distribution was changed.' }
if ($Terminate) {
    & wsl.exe --terminate $Distribution
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the owned CUDA distribution. Its disk was preserved.' }
}
