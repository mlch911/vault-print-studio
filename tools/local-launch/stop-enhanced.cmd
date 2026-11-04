@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0VAULT_Print_Studio_增强版\stop.ps1"
if errorlevel 1 pause
