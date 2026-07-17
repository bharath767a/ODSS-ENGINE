#!/bin/bash
# Background monitor loop — checks PM2 health every 5 minutes
# Does NOT auto-commit or revert files (that caused data loss)

export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

while true; do
  # Just check PM2 health, don't touch git
  if command -v pm2 >/dev/null 2>&1; then
    WEB_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  for p in json.load(sys.stdin):
    if p.get('name') == 'odss-web': print(p.get('pm2_env',{}).get('status','unknown')); break
except: print('error')
" 2>/dev/null || echo "error")

    if [ "$WEB_STATUS" != "online" ]; then
      echo "[$(date)] odss-web is $WEB_STATUS — restarting..."
      pm2 restart odss-web 2>/dev/null || true
    fi

    MARKET_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  for p in json.load(sys.stdin):
    if p.get('name') == 'odss-market': print(p.get('pm2_env',{}).get('status','unknown')); break
except: print('error')
" 2>/dev/null || echo "error")

    if [ "$MARKET_STATUS" != "online" ]; then
      echo "[$(date)] odss-market is $MARKET_STATUS — restarting..."
      pm2 restart odss-market 2>/dev/null || true
    fi
  fi

  # Ensure data directory exists
  mkdir -p /home/z/odss-data 2>/dev/null || true

  sleep 300  # 5 minutes
done
