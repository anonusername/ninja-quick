/<#
.SYNOPSIS
  Cleans previous build output and produces a fresh local Windows release build
  (NSIS installer + portable exe) via electron-builder.

.PARAMETER SkipInstall
  Skip `npm ci` and build against whatever is already in node_modules. Useful for
  quick rebuilds; omit this the first time or after changing dependencies.

.EXAMPLE
  .\build-windows-release.ps1
  .\build-windows-release.ps1 -SkipInstall
#>
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Cleaning previous build output (dist/)..." -ForegroundColor Cyan
if (Test-Path 'dist') {
  Remove-Item -Recurse -Force 'dist'
}

# electron-builder drives a real Electron process to package the app — same requirement as
# `npx electron . --dev` (see CLAUDE.md's environment gotcha). If this is set, require('electron')
# returns a path string instead of the API and the build silently misbehaves.
if ($env:ELECTRON_RUN_AS_NODE) {
  Write-Host "Unsetting ELECTRON_RUN_AS_NODE for this build..." -ForegroundColor Yellow
  $env:ELECTRON_RUN_AS_NODE = ""
}

if (-not $SkipInstall) {
  Write-Host "Installing dependencies (npm ci)..." -ForegroundColor Cyan
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

Write-Host "Building Windows release (NSIS installer + portable exe)..." -ForegroundColor Cyan
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }

Write-Host "`nDone. Output in .\dist\:" -ForegroundColor Green
Get-ChildItem -Path 'dist' -File -Filter '*.exe' |
  Select-Object Name, @{ Name = 'Size(MB)'; Expression = { [math]::Round($_.Length / 1MB, 2) } } |
  Format-Table -AutoSize
