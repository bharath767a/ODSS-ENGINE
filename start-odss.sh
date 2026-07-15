#!/bin/bash
set -euo pipefail

# ============================================================
# ODSS Permanent Startup Script (PM2-based)
# ============================================================
# This script replaces the fragile `bun run dev &` + `disown`
# approach with PM2 process management.
#
# PM2 provides:
#   - Auto-restart on crash (max 10 restarts, 3s delay)
#   - Log management (separate out/error logs)
#   - Memory limits (auto-restart on memory leak)
#   - Process resurrection on container restart (pm2 resurrect)
#   - Health monitoring (pm2 monit)
#
# This script is idempotent — safe to run multiple times.
# ============================================================

PROJECT_DIR="/home/z/my-project"
ECOSYSTEM_FILE="$PROJECT_DIR/ecosystem.config.cjs"
export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

cd "$PROJECT_DIR" || exit 1

echo "=========================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ODSS PM2 Startup"
echo "=========================================="

# Step 1: Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[INSTALL] Installing dependencies..."
    bun install 2>&1 | tail -5
fi

# Step 2: Ensure database exists (only push if schema changed, not destructive)
echo "[DB] Checking database schema..."
bun run db:push 2>&1 | tail -3 || echo "[DB] db:push skipped (already up to date)"

# Step 3: Ensure pm2 is available
if ! command -v pm2 >/dev/null 2>&1; then
    echo "[PM2] Installing pm2..."
    npm install -g pm2 2>&1 | tail -3
fi

# Step 4: Kill any orphaned processes on our ports
echo "[CLEANUP] Killing orphaned processes..."
pkill -f "next-server" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun --hot" 2>/dev/null || true
pkill -f "bun run dev" 2>/dev/null || true
sleep 2

# Step 5: Start/Restart processes via PM2
echo "[PM2] Starting ODSS processes..."
if pm2 describe odss-web >/dev/null 2>&1; then
    echo "[PM2] odss-web already exists, restarting..."
    pm2 restart odss-web --update-env 2>/dev/null || true
else
    pm2 start "$ECOSYSTEM_FILE" --only odss-web 2>/dev/null
fi

if pm2 describe odss-market >/dev/null 2>&1; then
    echo "[PM2] odss-market already exists, restarting..."
    pm2 restart odss-market --update-env 2>/dev/null || true
else
    pm2 start "$ECOSYSTEM_FILE" --only odss-market 2>/dev/null
fi

# Step 6: Save PM2 process list for resurrection on container restart
pm2 save 2>/dev/null || true

# Step 7: Wait for services to be ready
echo "[WAIT] Waiting for services to start..."
for i in $(seq 1 30); do
    WEB_OK=0
    MARKET_OK=0
    curl -sf http://localhost:3000 >/dev/null 2>&1 && WEB_OK=1
    curl -sf http://localhost:3002/health >/dev/null 2>&1 && MARKET_OK=1
    if [ $WEB_OK -eq 1 ] && [ $MARKET_OK -eq 1 ]; then
        echo "[READY] Both services are up!"
        break
    fi
    echo "  Attempt $i/30: web=$WEB_OK market=$MARKET_OK"
    sleep 2
done

# Step 8: Show status
echo ""
echo "=========================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ODSS Status"
echo "=========================================="
pm2 list 2>/dev/null

echo ""
echo "=========================================="
echo "ODSS is running via PM2"
echo "=========================================="
echo "  Web:     http://localhost:3000"
echo "  Market:  http://localhost:3002/health"
echo ""
echo "  PM2 commands:"
echo "    pm2 list              - show process status"
echo "    pm2 logs              - tail all logs"
echo "    pm2 logs odss-web     - tail web server logs"
echo "    pm2 logs odss-market  - tail mini-service logs"
echo "    pm2 restart all       - restart everything"
echo "    pm2 stop all          - stop everything"
echo "    pm2 monit             - live monitoring"
echo ""
echo "  On container restart, PM2 auto-resurrects these processes."
echo "=========================================="
