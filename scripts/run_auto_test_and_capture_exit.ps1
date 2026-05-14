param([int]$ms = 50)

$scriptPath = Join-Path $PSScriptRoot 'auto_test_early_fallback.js'
$recordingsDir = Join-Path $PSScriptRoot '..\recordings'
if (-not (Test-Path $recordingsDir)) { New-Item -ItemType Directory -Path $recordingsDir | Out-Null }
$stdout = Join-Path $recordingsDir 'cli_stdout_run.log'
$stderr = Join-Path $recordingsDir 'cli_stderr_run.log'
$exitFile = Join-Path $recordingsDir 'cli_exitcode_run.txt'

Write-Output "Running: node $scriptPath $ms"
& node $scriptPath $ms > $stdout 2> $stderr
$code = $LASTEXITCODE
Set-Content -Path $exitFile -Value $code -Encoding ascii
Write-Output "Exit code: $code"
