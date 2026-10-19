```bat
@echo off
setlocal
title Dashboard - Start All Services

:: Automatically detect the project root folder
set "ROOT=%~dp0"

echo ==========================================
echo       Starting Dashboard Services
echo ==========================================
echo.
echo Project Root: %ROOT%
echo.

echo [1/4] Starting ML Service...
start "ML Service" /D "%ROOT%ml_service" cmd /k "python main.py"

timeout /t 2 /nobreak >nul

echo [2/4] Starting Client Dashboard...
start "Client Dashboard" /D "%ROOT%leaf-dashboard (Client Dashboard)" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

echo [3/4] Starting Backend...
start "Backend" /D "%ROOT%backend" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

echo [4/4] Starting AFLC Service...
start "AFLC Service" /D "%ROOT%aflc" cmd /k "python aflc_service.py"

echo.
echo All 4 startup commands have been launched.
echo Keep the service windows open while using the dashboard.
echo.
pause

endlocal
```