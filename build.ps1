[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

& (Join-Path $root 'scripts\make-icon.ps1')

npm install
if ($LASTEXITCODE -ne 0) {
    throw 'npm install failed.'
}

npm run build
if ($LASTEXITCODE -ne 0) {
    throw 'electron-builder failed.'
}

$artifact = Get-ChildItem -Path (Join-Path $root 'dist') -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($artifact) {
    Write-Host "Build OK: $($artifact.FullName)"
} else {
    Write-Host 'Build completed, but no .exe artifact was found in dist.'
}
