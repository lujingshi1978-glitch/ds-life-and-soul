@echo off
cd /d "%~dp0"
node scripts\deploy.mjs stop
if errorlevel 1 pause
