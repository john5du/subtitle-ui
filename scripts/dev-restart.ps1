param(
  [switch]$SkipInstall,
  [int]$WaitTimeoutSec = 30
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[dev-restart] $Message"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$downScript = Join-Path $scriptDir "dev-down.ps1"
$upScript = Join-Path $scriptDir "dev-up.ps1"

if (!(Test-Path $downScript)) {
  throw "missing script: $downScript"
}
if (!(Test-Path $upScript)) {
  throw "missing script: $upScript"
}

Write-Step "Stopping existing services ..."
& $downScript -KillByPort -WaitTimeoutSec $WaitTimeoutSec
if ($LASTEXITCODE -ne 0) {
  throw "dev-down failed with exit code $LASTEXITCODE"
}

Write-Step "Starting services ..."
& $upScript -SkipInstall:$SkipInstall -WaitTimeoutSec $WaitTimeoutSec
if ($LASTEXITCODE -ne 0) {
  throw "dev-up failed with exit code $LASTEXITCODE"
}
