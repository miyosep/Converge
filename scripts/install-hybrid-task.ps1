param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectRoot '.env.hybrid'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Create .env.hybrid using docs/HYBRID_PC.md first.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
# This preflight reads the database only. Never start an unconfigured signer.
Push-Location $projectRoot
try {
  & $nodePath "--env-file=$envFile" --import tsx scripts/hybrid-worker.ts --check
  if ($LASTEXITCODE -ne 0) { throw 'Hybrid preflight failed.' }
} finally { Pop-Location }
$runnerPath = Join-Path $projectRoot 'scripts\run-hybrid-task.ps1'
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`" -NodePath `"$nodePath`"" -WorkingDirectory $projectRoot
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'Converge Hybrid Processor' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName 'Converge Hybrid Processor' }
Write-Output 'Installed Converge Hybrid Processor for this Windows user. Logs: .hybrid/processor.log'
