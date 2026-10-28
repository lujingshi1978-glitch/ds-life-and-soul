@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node scripts/deploy.mjs repair-core
if errorlevel 1 echo 修复未完成，请按上方提示处理。
pause
