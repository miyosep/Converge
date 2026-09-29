param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$servicePath = Join-Path $projectRoot 'scripts\hybrid-service.ts'
$processor = Start-Process -FilePath $NodePath -ArgumentList @('--import', 'tsx', "`"$servicePath`"", '--background') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
exit $processor.ExitCode
