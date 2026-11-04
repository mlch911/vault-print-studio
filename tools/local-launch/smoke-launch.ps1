$ErrorActionPreference='Stop'
$launchRoot=Join-Path (Get-Location) 'tools\local-launch'
$fixture=Join-Path $launchRoot ('.smoke-'+[guid]::NewGuid().ToString('N'))
if(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 5187 -State Listen -ErrorAction SilentlyContinue){throw 'Port 5187 is already in use; smoke test will not disturb it.'}
New-Item -ItemType Directory -Path (Join-Path $fixture 'dist') | Out-Null
foreach($file in @('server.mjs','launch.ps1','stop.ps1')){Copy-Item -LiteralPath (Join-Path $launchRoot $file) -Destination (Join-Path $fixture $file)}
'<!doctype html><h1>Launcher smoke</h1>' | Set-Content -LiteralPath (Join-Path $fixture 'dist\index.html') -Encoding ascii
'{"version":"smoke"}' | Set-Content -LiteralPath (Join-Path $fixture 'dist\version.json') -Encoding ascii
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'launch.ps1') -NoBrowser
    if($LASTEXITCODE -ne 0){throw 'Launch failed'}
    $health1=Invoke-RestMethod -Uri 'http://127.0.0.1:5187/__vault/health' -TimeoutSec 3
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'launch.ps1') -NoBrowser
    if($LASTEXITCODE -ne 0){throw 'Reuse failed'}
    $health2=Invoke-RestMethod -Uri 'http://127.0.0.1:5187/__vault/health' -TimeoutSec 3
    if($health1.pid -ne $health2.pid -or $health1.instanceId -ne $health2.instanceId){throw 'Repeated launch created different service'}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'stop.ps1')
    if($LASTEXITCODE -ne 0){throw 'Stop failed'}
    Start-Sleep -Milliseconds 300
    $remaining=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 5187 -State Listen -ErrorAction SilentlyContinue
    if($remaining){throw 'Test service remained active'}
    Write-Output 'PASS: Windows PowerShell 5.1 launcher started hidden, reused the same process, and stopped by token.'
} finally {
    if(Test-Path -LiteralPath (Join-Path $fixture '.launcher\runtime.json')){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'stop.ps1')}
    $resolved=[IO.Path]::GetFullPath($fixture)
    if([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath($launchRoot) -or -not [IO.Path]::GetFileName($resolved).StartsWith('.smoke-')){throw 'Unsafe cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}