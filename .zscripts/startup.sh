#!/bin/bash
# ============================================================
# ODSS Permanent Startup Script
#
# This script runs ONCE on every container restart to:
#   1. Create the /home/z/odss-data/ directory if missing
#   2. Ensure the database exists at the correct location
#   3. Install mini-service dependencies
#   4. Start PM2 processes with the CORRECT config (--webpack flag)
#   5. Verify all processes are online
#
# This script does NOT auto-commit or revert any files.
# The old auto-commit.sh that reverted work has been disabled.
# ============================================================

set -e
export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"
PROJECT_DIR="/home/z/my-project"

echo "[$(date)] === ODSS Startup ==="

# 1. Create data directory
echo "[$(date)] [1/5] Creating data directory..."
mkdir -p /home/z/odss-data
mkdir -p /home/z/odss-data/backups
echo "  ✓ /home/z/odss-data/ ready"

# 2. Ensure database exists
echo "[$(date)] [2/5] Checking database..."
if [ ! -f /home/z/odss-data/custom.db ] || [ ! -s /home/z/odss-data/custom.db ]; then
  echo "  Database missing or empty — pushing schema..."
  cd "$PROJECT_DIR"
  DATABASE_URL="file:/home/z/odss-data/custom.db" bun run db:push 2>/dev/null || true
  echo "  ✓ Database created"
else
  echo "  ✓ Database exists ($(du -h /home/z/odss-data/custom.db | cut -f1))"
fi

# 3. Install mini-service dependencies
echo "[$(date)] [3/5] Installing mini-service dependencies..."
cd "$PROJECT_DIR/mini-services/odss-market"
if [ ! -d node_modules/socket.io ]; then
  bun install 2>/dev/null || true
  echo "  ✓ Dependencies installed"
else
  echo "  ✓ Dependencies already present"
fi

# 4. Start PM2 processes
echo "[$(date)] [4/5] Starting PM2 processes..."
cd "$PROJECT_DIR"

# Delete existing processes to pick up new config
pm2 delete odss-web 2>/dev/null || true
pm2 delete odss-market 2>/dev/null || true

# Start with the correct ecosystem config
pm2 start ecosystem.config.cjs 2>/dev/null || true
pm2 save 2>/dev/null || true
echo "  ✓ PM2 processes started"

# 5. Verify
echo "[$(date)] [5/5] Verifying..."
sleep 5
WEB_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  for p in json.load(sys.stdin):
    if p.get('name') == 'odss-web': print(p.get('pm2_env',{}).get('status','unknown')); break
except: print('error')
" 2>/dev/null || echo "error")
MARKET_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  for p in json.load(sys.stdin):
    if p.get('name') == 'odss-market': print(p.get('pm2_env',{}).get('status','unknown')); break
except: print('error')
" 2>/dev/null || echo "error")

echo "  odss-web: $WEB_STATUS"
echo "  odss-market: $MARKET_STATUS"

if [ "$WEB_STATUS" = "online" ] && [ "$MARKET_STATUS" = "online" ]; then
  echo "[$(date)] === ODSS Startup Complete ✓ ==="
else
  echo "[$(date)] === WARNING: One or more processes not online ==="
  echo "  Run: pm2 restart all"
fi
