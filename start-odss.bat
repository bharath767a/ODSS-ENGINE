@echo off
REM =====================================================================
REM  ODSS Engine - daily launcher (Windows)
REM  Double-click this file each day to start the engine.
REM  Opens two windows (Market Service + Web) and your browser.
REM  Close those two windows to stop the engine.
REM =====================================================================
setlocal

REM --- Runtime data dir (state, DB, archive) lives OUTSIDE the repo so a
REM --- code update / reset never wipes it. Change ODSS_DATA_DIR to move it. ---
set "ODSS_DATA_DIR=%USERPROFILE%\.odss-data"
set "DATABASE_URL=file:%ODSS_DATA_DIR%\custom.db"
set "NODE_OPTIONS=--max-old-space-size=1024"
REM Strict real-data-only: never serve synthetic quotes/chains/greeks/VIX.
set "ODSS_REAL_DATA_ONLY=true"
REM --- Make sure bun (installed to %USERPROFILE%\.bun) is on PATH ---
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
set "REPO=%~dp0"

if not exist "%ODSS_DATA_DIR%" mkdir "%ODSS_DATA_DIR%"

echo ============================================================
echo   ODSS Engine
echo   Repo:     %REPO%
echo   Data dir: %ODSS_DATA_DIR%
echo ============================================================
echo.
echo Starting Market Service (port 3002) and Web (port 3000)...
echo (Bridge/Dhan must be running on your laptop for real option data.)
echo.

REM Child windows inherit the env vars set above.
start "ODSS Market Service (3002)" /D "%REPO%mini-services\odss-market" cmd /k bun index.ts
start "ODSS Web (3000)" /D "%REPO%" cmd /k npx next dev -p 3000 --webpack

echo Waiting ~14s for servers to boot...
timeout /t 14 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo ODSS is running. Dashboard: http://localhost:3000
echo To stop: close the two "ODSS ..." windows.
echo.
pause
endlocal
