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
set "REPO=%~dp0"
cd /d "%REPO%"

echo ============================================================
echo   ODSS - VIEW-ONLY SHARE  (read-only, no source, expires today)
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
start "ODSS View-Only (3001)" cmd /k "set ODSS_SHARE=1&& set ODSS_DIST_DIR=.next-share&& set ODSS_VIEW_ONLY=1&& set NEXT_PUBLIC_ODSS_VIEW_ONLY=1&& set ODSS_DATA_DIR=%ODSS_DATA_DIR%&& set DATABASE_URL=%DATABASE_URL%&& npx next start -p 3001"
timeout /t 10 /nobreak >nul

echo [3/3] Opening the public tunnel...
start "ODSS ngrok - SHARE THIS URL" cmd /k "ngrok http 3001"

echo.
echo ============================================================
echo  Copy the https://....ngrok URL from the NGROK window and
echo  send it to your mentor. It is READ-ONLY and expires today.
echo ============================================================
echo Auto-expiry armed for 15:31 IST. Keep THIS window open.
echo (Close this or the ngrok window to expire the link early.)
powershell -NoProfile -Command "$c=[DateTime]::Today.AddHours(15).AddMinutes(31);$n=Get-Date;if($n -lt $c){Start-Sleep -Seconds ([int]($c-$n).TotalSeconds)};Get-Process ngrok -ErrorAction SilentlyContinue|Stop-Process -Force;Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue|ForEach-Object{Stop-Process -Id $_.OwningProcess -Force};Write-Host 'View-only share EXPIRED (market close).'"
echo Share expired.
pause
endlocal
