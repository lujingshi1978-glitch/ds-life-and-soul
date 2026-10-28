@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
node scripts\deploy.mjs launch %*
if errorlevel 1 pause
