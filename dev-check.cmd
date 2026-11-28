@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node 22 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node scripts\dev-check.mjs
echo.
pause
