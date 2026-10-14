#Requires -Version 5.1
<#
.SYNOPSIS
  Start the API for local development, stopping at the first failed stage.

.DESCRIPTION
  Works in Windows PowerShell 5.1 and PowerShell 7. Every native command's
  exit code is checked explicitly ($ErrorActionPreference does not see native
  exit codes), and no later stage runs after a failure. Milestones are kept
  separate:

    1. Preflight: runtime, ports and a COMPLETE generated Prisma client
       (read-only check of the completion record; it does not generate).
    2. Dependency builds: database, then contracts.
    3. API typecheck (skip with -SkipTypecheck).
    4. Server listening, then GET /health/ready 200 (reported by run-api.cjs).

  Browser journeys are a separate step and are not implied by any of these.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev\start-api.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipTypecheck
)

Set-StrictMode -Version 3.0
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Stage {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$Command,
    [string[]]$Arguments = @()
  )
  Write-Host "==> $Name"
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $global:LASTEXITCODE = 0
  & $Command @Arguments
  $code = $LASTEXITCODE
  $seconds = [Math]::Round($timer.Elapsed.TotalSeconds, 1)
  if ($code -ne 0) {
    Write-Host "FAIL $Name (exit code $code after ${seconds}s). Later stages were not run." -ForegroundColor Red
    exit $code
  }
  Write-Host "OK   $Name (${seconds}s)" -ForegroundColor Green
}

Push-Location -LiteralPath $root
try {
  Invoke-Stage -Name 'Preflight: runtime, API port and generated Prisma client' -Command 'node' -Arguments @('scripts/dev/preflight.cjs', '--api')
  Invoke-Stage -Name 'Build @homeservicemarketplace/database' -Command 'pnpm' -Arguments @('--filter', '@homeservicemarketplace/database', 'build')
  Invoke-Stage -Name 'Build @homeservicemarketplace/contracts' -Command 'pnpm' -Arguments @('--filter', '@homeservicemarketplace/contracts', 'build')
  if (-not $SkipTypecheck) {
    Invoke-Stage -Name 'Typecheck the API' -Command 'pnpm' -Arguments @('--filter', '@homeservicemarketplace/api', 'exec', 'tsc', '--noEmit')
  }
  Write-Host '==> Start the API watcher (milestones follow; Ctrl+C stops it)'
  $global:LASTEXITCODE = 0
  & node 'scripts/dev/run-api.cjs'
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
