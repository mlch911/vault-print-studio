$ErrorActionPreference='Stop'
$origin='http://127.0.0.1:5187'
try {
    $controlPath=Join-Path $PSScriptRoot '.launcher\runtime.json'
    if(-not(Test-Path -LiteralPath $controlPath)){Write-Output '没有本增强版的运行记录，无需停止。';exit 0}
    $control=Get-Content -LiteralPath $controlPath -Raw -Encoding utf8 | ConvertFrom-Json
    if($control.appId -ne 'vault-print-studio-local-enhanced' -or $control.controlToken -notmatch '^[a-f0-9]{64}$'){throw '运行记录无效，未停止任何进程。'}
    try {$health=Invoke-RestMethod -Uri ($origin+'/__vault/health') -TimeoutSec 2 -UseBasicParsing}
    catch {Write-Output '本增强版没有运行，或端口已由其他程序使用；未停止任何进程。';exit 0}
    if($health.appId -ne $control.appId -or $health.instanceId -ne $control.instanceId){throw '此端口不是本目录启动的 VAULT，未停止任何进程。'}
    Invoke-RestMethod -Uri ($origin+'/__vault/stop') -Method Post -Headers @{'X-Vault-Control'=$control.controlToken} -TimeoutSec 5 -UseBasicParsing | Out-Null
    Write-Output 'VAULT 本地服务已停止。模型、配置和打印进度未删除。'
} catch {Write-Host ('停止失败：'+$_.Exception.Message) -ForegroundColor Red;exit 1}
