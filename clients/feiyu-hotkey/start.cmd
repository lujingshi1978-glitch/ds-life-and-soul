@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" -m feiyu_hotkey %*
  exit /b 0
)
where pyw >nul 2>nul
if not errorlevel 1 (
  start "" pyw -3 -m feiyu_hotkey %*
  exit /b 0
)
where pythonw >nul 2>nul
if not errorlevel 1 (
  start "" pythonw -m feiyu_hotkey %*
  exit /b 0
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m feiyu_hotkey %*
  exit /b %errorlevel%
)
echo Please install Python 3.11+ for Windows with Tcl/Tk, then run start.cmd again.
pause
exit /b 1
