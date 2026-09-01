@echo off
title NSE Option Chain Viewer Local Server
cd /d "%~dp0"

echo ===================================================
echo          NSE OPTION CHAIN VIEWER LAUNCHER         
echo ===================================================
echo.
echo Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please ensure Node.js is installed.
    pause
    exit /b 1
)

echo Checking dependencies...
if not exist "node_modules" (
    echo Installing required packages (first time setup)...
    call npm install
)

echo Starting local web server on port 3000...
start "" http://localhost:3000

echo.
echo Server is running at http://localhost:3000
echo Keep this window open while using the application.
echo Press Ctrl+C in this window to stop the server.
echo.

node server.js
pause
