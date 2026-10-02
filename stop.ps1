$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$controlPath = Join-Path $projectDirectory '.logs\server-control.json'
if (-not (Test-Path -LiteralPath $controlPath)) { Write-Output '이 프로젝트에서 실행한 서버가 없습니다.'; exit }
$control = [IO.File]::ReadAllText($controlPath) | ConvertFrom-Json
if ($control.app -ne 'paperflip' -or $control.projectRoot -ne $projectDirectory -or -not $control.token -or $control.port -lt 1 -or $control.port -gt 65535) { throw '서버 실행 기록을 확인할 수 없습니다.' }
$readerUrl = "http://127.0.0.1:$($control.port)"
$health = $null
try { $health = Invoke-RestMethod -Uri "$readerUrl/api/health" -TimeoutSec 2 -UseBasicParsing } catch {}
if (-not $health) { Remove-Item -LiteralPath $controlPath; Write-Output '서버가 이미 중지되어 있습니다.'; exit }
if ($health.app -ne 'paperflip' -or $health.projectRoot -ne $projectDirectory -or $health.instanceId -ne $control.instanceId) { throw '실행 기록과 현재 서버가 달라 중지하지 않았습니다.' }
$null = Invoke-RestMethod -Uri "$readerUrl/api/shutdown" -Method Post -Headers @{ 'X-Paperflip-Control' = [string]$control.token } -TimeoutSec 3 -UseBasicParsing
Write-Output '책 뷰어 서버를 중지했습니다.'
