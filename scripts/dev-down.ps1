param(
  [switch]$KillByPort,
  [int]$WaitTimeoutSec = 20
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[dev-down] $Message"
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

function Wait-PortClosed {
  param(
    [int]$Port,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $listenerPid = Get-ListenerPid -Port $Port
    if (-not $listenerPid) {
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Stop-ProcessByPid {
  param(
    [int]$ProcessId,
    [string]$Label
  )

  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    Write-Step "$Label PID=$ProcessId is not running."
    return $false
  }

  Write-Step "Stopping $Label PID=$ProcessId ($($proc.ProcessName)) ..."
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  return $true
}

function Stop-ByPidFile {
  param(
    [string]$Label,
    [string]$PidFile
  )

  if (!(Test-Path $PidFile)) {
    Write-Step "$Label pid file not found: $PidFile"
    return
  }

  $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Step "$Label pid file was empty."
    return
  }

  $parsed = 0
  if (![int]::TryParse($raw, [ref]$parsed)) {
    Write-Step "$Label pid file value is invalid: $raw"
    return
  }

  [void](Stop-ProcessByPid -ProcessId $parsed -Label $Label)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$tmpDir = Join-Path $repoRoot "tmp"
$backendPort = 9307
$frontendPort = 3300

$backendPidFile = Join-Path $tmpDir "backend.pid"
$frontendPidFile = Join-Path $tmpDir "frontend.pid"

Write-Step "Stopping services from pid files ..."
Stop-ByPidFile -Label "backend" -PidFile $backendPidFile
Stop-ByPidFile -Label "frontend" -PidFile $frontendPidFile

if ($KillByPort) {
  Write-Step "Kill-by-port fallback enabled."

  $frontendPid = Get-ListenerPid -Port $frontendPort
  if ($frontendPid) {
    [void](Stop-ProcessByPid -ProcessId $frontendPid -Label "frontend(:$frontendPort)")
  } else {
    Write-Step "No listener on :$frontendPort."
  }

  $backendPid = Get-ListenerPid -Port $backendPort
  if ($backendPid) {
    [void](Stop-ProcessByPid -ProcessId $backendPid -Label "backend(:$backendPort)")
  } else {
    Write-Step "No listener on :$backendPort."
  }
}

$frontClosed = Wait-PortClosed -Port $frontendPort -TimeoutSec $WaitTimeoutSec
$backClosed = Wait-PortClosed -Port $backendPort -TimeoutSec $WaitTimeoutSec

if (!$frontClosed -or !$backClosed) {
  $leftFront = Get-ListenerPid -Port $frontendPort
  $leftBack = Get-ListenerPid -Port $backendPort
  throw "Ports not fully released in time. :$frontendPort=$leftFront :$backendPort=$leftBack"
}

Write-Host ""
Write-Host "Stopped:"
Write-Host "  Frontend :$frontendPort"
Write-Host "  Backend  :$backendPort"
