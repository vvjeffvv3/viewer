param([int]$Port = 8787, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$serverPath = Join-Path $projectDirectory 'server.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js를 찾을 수 없습니다. Node.js 설치 후 다시 실행해 주세요.' }
if ($Port -lt 1024 -or $Port -gt 65525) { throw '포트는 1024부터 65525 사이로 지정해 주세요.' }
$logsDirectory = Join-Path $projectDirectory '.logs'
New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
$serverStarted = $false
for ($candidatePort = $Port; $candidatePort -le $Port + 10; $candidatePort++) {
  $readerUrl = "http://127.0.0.1:$candidatePort"
  $health = $null
  try { $health = Invoke-RestMethod -Uri "$readerUrl/api/health" -TimeoutSec 1 -UseBasicParsing } catch {}
  if ($health -and $health.app -eq 'paperflip' -and $health.projectRoot -eq $projectDirectory -and $health.managedControl) { $serverStarted = $true; break }
  $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidatePort)
  try { $portProbe.Start() } catch { continue } finally { $portProbe.Stop() }
  $nodeProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $serverPath + '"'), '--port', [string]$candidatePort) -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logsDirectory 'server.log') -RedirectStandardError (Join-Path $logsDirectory 'server-error.log') -PassThru
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    Start-Sleep -Milliseconds 120
    if ($nodeProcess.HasExited) { break }
    try { $health = Invoke-RestMethod -Uri "$readerUrl/api/health" -TimeoutSec 1 -UseBasicParsing } catch { $health = $null }
    if ($health -and $health.app -eq 'paperflip' -and $health.projectRoot -eq $projectDirectory -and $health.managedControl -and (Test-Path -LiteralPath (Join-Path $logsDirectory 'server-control.json'))) {
      $serverStarted = $true; break
    }
  }
  if ($serverStarted) { break }
}
if (-not $serverStarted) { throw '책 뷰어를 시작하지 못했습니다. .logs 폴더의 server-error.log를 확인해 주세요.' }
if (-not $NoOpen) { Start-Process $readerUrl }
Write-Output $readerUrl
