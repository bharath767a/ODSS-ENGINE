@echo off
REM =====================================================================
REM  ODSS - VIEW-ONLY SHARE
REM  Creates a READ-ONLY public link (for a mentor) that:
REM    - shows the live engine (picks, control, positions, performance)
REM    - hides ALL controls (no Take/Close/Reset/Config/credentials)
REM    - exposes NO source code (production build, no source maps)
REM    - auto-EXPIRES at 15:31 IST (after market close)
REM  Your own full dashboard keeps running on http://localhost:3000.
REM  This runs a SEPARATE view-only site on port 3001 and tunnels it.
REM =====================================================================
setlocal
set "ODSS_DATA_DIR=%USERPROFILE%\.odss-data"
set "DATABASE_URL=file:%ODSS_DATA_DIR%\custom.db"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

REM --- Locate the ODSS-ENGINE repo (this file's folder, else C:\ODSS-ENGINE) ---
set "REPO=%~dp0"
if not exist "%REPO%src\app" if exist "C:\ODSS-ENGINE\src\app" set "REPO=C:\ODSS-ENGINE\"
cd /d "%REPO%" 2>nul
if not exist "src\app" (
  echo ============================================================
  echo  ERROR: Could not find the ODSS-ENGINE project.
  echo  Run this file from INSIDE your repo folder — i.e. double-click
  echo      C:\ODSS-ENGINE\share-viewonly.bat
  echo  ^(not a copy saved in Downloads^).
  echo ============================================================
  pause
  exit /b 1
)

REM --- Find ngrok: repo copy, then PATH, then your original ODSS folder ---
set "NGROK="
if exist "%REPO%nse-bridge\ngrok.exe" set "NGROK=%REPO%nse-bridge\ngrok.exe"
if not defined NGROK ( where ngrok >nul 2>&1 && set "NGROK=ngrok" )
if not defined NGROK if exist "%USERPROFILE%\OneDrive\Desktop\ODSS\nse-bridge\ngrok.exe" set "NGROK=%USERPROFILE%\OneDrive\Desktop\ODSS\nse-bridge\ngrok.exe"

echo ============================================================
echo   ODSS - VIEW-ONLY SHARE  (read-only, no source, expires today)
echo   Repo:  %REPO%
echo   ngrok: %NGROK%
echo ============================================================
echo The Market Service must be running (start-odss.bat) for live data.
echo.

echo [1/3] Building view-only production (separate build, no source maps)...
set "ODSS_SHARE=1"
set "ODSS_DIST_DIR=.next-share"
set "NEXT_PUBLIC_ODSS_VIEW_ONLY=1"
REM --webpack: this project uses webpack (not Turbopack) — matches the dev server.
call npx next build --webpack
if errorlevel 1 ( echo BUILD FAILED. & pause & exit /b 1 )

echo [2/3] Starting the view-only server on port 3001...
REM Free port 3001 from any previous run so we don't hit EADDRINUSE.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
start "ODSS View-Only (3001)" cmd /k "set ODSS_SHARE=1&& set ODSS_DIST_DIR=.next-share&& set ODSS_VIEW_ONLY=1&& set NEXT_PUBLIC_ODSS_VIEW_ONLY=1&& set ODSS_DATA_DIR=%ODSS_DATA_DIR%&& set DATABASE_URL=%DATABASE_URL%&& npx next start -p 3001"
timeout /t 10 /nobreak >nul

echo [3/3] Opening the public tunnel...
if not defined NGROK (
  echo WARNING: ngrok not found. Install it, or run manually in another window:
  echo     ngrok http 3001
) else (
  start "ODSS ngrok - SHARE THIS URL" cmd /k ""%NGROK%" http 3001"
)

echo.
echo ============================================================
echo  Copy the https://....ngrok URL from the NGROK window and
echo  send it to your mentor. It is READ-ONLY and expires today.
echo ============================================================
echo Auto-expiry armed for 15:30 IST (market close). Keep THIS window open.
echo (Close this or the ngrok window to expire the link early.)
powershell -NoProfile -Command "$c=[DateTime]::Today.AddHours(15).AddMinutes(30);$n=Get-Date;if($n -lt $c){Start-Sleep -Seconds ([int]($c-$n).TotalSeconds)};Get-Process ngrok -ErrorAction SilentlyContinue|Stop-Process -Force;Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue|ForEach-Object{Stop-Process -Id $_.OwningProcess -Force};Write-Host 'View-only share EXPIRED at market close (15:30).'"
echo Share expired.
pause
endlocal
