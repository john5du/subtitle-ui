param(
  [switch]$SkipInstall,
  [int]$WaitTimeoutSec = 30
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[dev-up] $Message"
}

function Get-ListenerPid {
  param([int]$Port)

  try {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
    $listenerPid = $conns | Select-Object -First 1 -ExpandProperty OwningProcess
    if ($listenerPid) { return [int]$listenerPid }
  } catch {
    # Fallback to netstat parsing.
  }

  $line = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)" | Select-Object -First 1
  if (-not $line) { return $null }

  $m = [regex]::Match($line.Line, "LISTENING\s+(\d+)\s*$")
  if ($m.Success) {
    return [int]$m.Groups[1].Value
  }
  return $null
}

function Wait-PortOpen {
  param(
    [int]$Port,
    [int]$TimeoutSec = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $listenerPid = Get-ListenerPid -Port $Port
    if ($listenerPid) {
      return $listenerPid
    }
    Start-Sleep -Milliseconds 300
  }
  return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$frontendDir = Join-Path $repoRoot "frontend"
$tmpDir = Join-Path $repoRoot "tmp"
$backendPort = 9307
$frontendPort = 3300

if (!(Test-Path $frontendDir)) {
  throw "frontend directory not found: $frontendDir"
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$backendOut = Join-Path $tmpDir "backend.out.log"
$backendErr = Join-Path $tmpDir "backend.err.log"
$frontendOut = Join-Path $tmpDir "frontend.out.log"
$frontendErr = Join-Path $tmpDir "frontend.err.log"

$backendPidFile = Join-Path $tmpDir "backend.pid"
$frontendPidFile = Join-Path $tmpDir "frontend.pid"

# Start backend (:9307)
$backendPid = Get-ListenerPid -Port $backendPort
if ($backendPid) {
  Write-Step "Backend already listening on :$backendPort (PID=$backendPid)."
} else {
  Write-Step "Starting backend on :$backendPort ..."
  if (Test-Path $backendOut) { Remove-Item $backendOut -Force }
  if (Test-Path $backendErr) { Remove-Item $backendErr -Force }

  $backendProcess = Start-Process `
    -FilePath "go" `
    -ArgumentList "run ./backend/cmd/server" `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -PassThru

  $backendPid = Wait-PortOpen -Port $backendPort -TimeoutSec $WaitTimeoutSec
  if (-not $backendPid) {
    throw "Backend failed to listen on :$backendPort within $WaitTimeoutSec seconds. See $backendErr"
  }
  Write-Step "Backend is up (PID=$backendPid)."
}

# Ensure frontend deps.
$nodeModulesDir = Join-Path $frontendDir "node_modules"
if (!$SkipInstall -and !(Test-Path $nodeModulesDir)) {
  Write-Step "frontend/node_modules not found. Installing dependencies ..."
  Push-Location $frontendDir
  try {
    npm install
  } finally {
    Pop-Location
  }
}

# Start frontend dev (:3300)
$frontendPid = Get-ListenerPid -Port $frontendPort
if ($frontendPid) {
  Write-Step "Frontend already listening on :$frontendPort (PID=$frontendPid)."
} else {
  Write-Step "Starting frontend dev server on :$frontendPort ..."
  if (Test-Path $frontendOut) { Remove-Item $frontendOut -Force }
  if (Test-Path $frontendErr) { Remove-Item $frontendErr -Force }

  $frontendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run dev" `
    -WorkingDirectory $frontendDir `
    -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr `
    -PassThru

  $frontendPid = Wait-PortOpen -Port $frontendPort -TimeoutSec $WaitTimeoutSec
  if (-not $frontendPid) {
    throw "Frontend failed to listen on :$frontendPort within $WaitTimeoutSec seconds. See $frontendErr"
  }
  Write-Step "Frontend is up (PID=$frontendPid)."
}

Set-Content -Path $backendPidFile -Encoding ASCII -Value "$backendPid"
Set-Content -Path $frontendPidFile -Encoding ASCII -Value "$frontendPid"

Write-Host ""
Write-Host "Ready:"
Write-Host "  Frontend: http://localhost:$frontendPort (PID=$frontendPid)"
Write-Host "  Backend : http://localhost:$backendPort (PID=$backendPid)"
Write-Host ""
Write-Host "Logs:"
Write-Host "  $frontendOut"
Write-Host "  $frontendErr"
Write-Host "  $backendOut"
Write-Host "  $backendErr"
