@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node scripts/deploy.mjs qq
if errorlevel 1 echo QQ配置未完成，请按上方提示处理后重试。
pause
