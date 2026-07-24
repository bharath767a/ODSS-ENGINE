# ODSS — expire the view-only share (kills the tunnel + the :3001 view-only server).
# Scheduled to run at market close (15:30 IST). Safe to run manually any time.
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Write-Output "ODSS view-only share EXPIRED at $(Get-Date -Format 'HH:mm:ss')"
