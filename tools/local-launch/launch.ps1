param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$appId='vault-print-studio-local-enhanced'
$origin='http://127.0.0.1:5187'
$runtime=Join-Path $PSScriptRoot '.launcher'
$identityPath=Join-Path $runtime 'identity.json'
$controlPath=Join-Path $runtime 'runtime.json'
function Health { try { return Invoke-RestMethod -Uri ($origin+'/__vault/health') -TimeoutSec 2 -UseBasicParsing } catch { return $null } }
function Open-App { if(-not $NoBrowser){Start-Process -FilePath ($origin+'/')} }
try {
    if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html') -PathType Leaf)){throw '没有找到 dist\index.html，请重新安装完整增强版。'}
    if(-not(Test-Path -LiteralPath $runtime)){New-Item -ItemType Directory -Path $runtime | Out-Null}
    if(Test-Path -LiteralPath $identityPath){$identity=Get-Content -LiteralPath $identityPath -Raw -Encoding utf8 | ConvertFrom-Json}
    else {$identity=@{instanceId=[guid]::NewGuid().ToString('N')};$identity | ConvertTo-Json | Set-Content -LiteralPath $identityPath -Encoding utf8}
    if($identity.instanceId -notmatch '^[a-f0-9]{32}$'){throw '启动器身份文件无效，请联系维护者检查 .launcher\identity.json。'}
    $health=Health
    if($health){
        if($health.appId -ne $appId -or $health.instanceId -ne $identity.instanceId){throw '端口 5187 正被另一程序或另一份 VAULT 使用。请先关闭对应程序；启动器不会结束其他进程。'}
        Open-App
        Write-Output '已打开正在运行的 VAULT 增强版。'
        exit 0
    }
    $listener=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 5187 -State Listen -ErrorAction SilentlyContinue
    if($listener){throw '端口 5187 已被占用且无法确认是本增强版。请先关闭对应程序。'}
    $node=(Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if(-not $node){throw '未找到 Node.js。请安装 Node.js 24，再重新打开本入口。'}
    $nodeVersion=& $node --version
    $major=[int]($nodeVersion.TrimStart('v').Split('.')[0])
    if($major -lt 24){throw '本增强版需要 Node.js 24 或更新版本。'}
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$bytes=New-Object byte[] 32;$rng.GetBytes($bytes);$rng.Dispose()
    $token=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
    @{appId=$appId;instanceId=$identity.instanceId;controlToken=$token;port=5187;status='starting'} | ConvertTo-Json | Set-Content -LiteralPath $controlPath -Encoding utf8
    $serverPath=Join-Path $PSScriptRoot 'server.mjs'
    $arguments='"'+$serverPath+'" --control-file "'+$controlPath+'"'
    $child=Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server-output.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    for($attempt=0;$attempt -lt 25;$attempt++){
        Start-Sleep -Milliseconds 200
        $health=Health
        if($health -and $health.appId -eq $appId -and $health.instanceId -eq $identity.instanceId){Open-App;Write-Output 'VAULT 增强版已启动。关闭浏览器不会删除打印进度。';exit 0}
        $child.Refresh()
        if($child.HasExited){break}
    }
    $detail=if(Test-Path -LiteralPath (Join-Path $runtime 'server-error.log')){Get-Content -LiteralPath (Join-Path $runtime 'server-error.log') -Raw -Encoding utf8}else{''}
    throw ('启动未完成。请检查端口 5187，并查看 .launcher\server-error.log。 '+$detail)
} catch {Write-Host ('VAULT 启动失败：'+$_.Exception.Message) -ForegroundColor Red;exit 1}
