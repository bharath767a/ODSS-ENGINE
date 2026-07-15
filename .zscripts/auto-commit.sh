#!/bin/bash
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

cd "$PROJECT_DIR"

LOG_FILE="$PROJECT_DIR/.zscripts/auto-commit.log"
ALERT_FILE="$PROJECT_DIR/.zscripts/alerts.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

alert() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $1" >> "$ALERT_FILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $1"
}

# 1. Auto-commit source changes
log "Checking for uncommitted changes..."
if ! git diff --quiet -- src/ mini-services/ ecosystem.config.cjs 2>/dev/null; then
  log "Uncommitted changes found — committing..."
  git add src/ mini-services/ ecosystem.config.cjs
  git commit -m "auto-commit: $(date '+%Y-%m-%d %H:%M:%S')" --no-gpg-sign 2>/dev/null || true
  log "Changes committed."
else
  log "No uncommitted changes."
fi

# 2. Verify critical files exist
CRITICAL_FILES=(
  "src/app/page.tsx"
  "src/app/globals.css"
  "src/app/layout.tsx"
  "src/lib/odss/orchestrator.ts"
  "src/lib/odss/simulator/market-simulator.ts"
  "src/lib/odss/data-providers/router.ts"
  "src/lib/odss/data-providers/yahoo-provider.ts"
  "src/lib/odss/data-providers/nse-provider.ts"
  "src/lib/odss/paper-trading/paper-trade-manager.ts"
  "src/lib/odss/learning/learning-engine.ts"
  "src/lib/odss/learning/strategy-performance-tracker.ts"
  "src/lib/odss/strategy-lab/strategy-genome.ts"
  "src/lib/odss/strategy-lab/evolution-engine.ts"
  "src/components/odss/journal/journal-table.tsx"
  "src/components/odss/market-brief/market-brief-panel.tsx"
  "src/components/odss/health/health-monitor.tsx"
  "src/components/odss/learning/learning-panel.tsx"
  "src/components/odss/strategy-lab/strategy-lab-panel.tsx"
  "src/components/odss/paper-trading/paper-trading-panel.tsx"
  "src/components/odss/fundamentals/stock-analysis-tab.tsx"
  "src/components/odss/fundamentals/swing-tab.tsx"
  "src/components/odss/fundamentals/seasonal-components.tsx"
  "src/components/odss/alerts/news-alerts.tsx"
  "src/components/odss/alerts/news-popup.tsx"
  "src/components/odss/search/stock-search.tsx"
  "ecosystem.config.cjs"
)

MISSING=0
for f in "${CRITICAL_FILES[@]}"; do
  if [ ! -f "$PROJECT_DIR/$f" ]; then
    alert "CRITICAL FILE MISSING: $f"
    if git show HEAD:"$f" > /dev/null 2>&1; then
      log "Restoring $f from git..."
      git checkout HEAD -- "$f" 2>/dev/null || true
      log "Restored $f"
    else
      alert "CANNOT RESTORE: $f not in git history!"
    fi
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -eq 0 ]; then
  log "All critical files present."
fi

# 3. Check PM2 process health
if command -v pm2 >/dev/null 2>&1; then
  WEB_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  procs = json.load(sys.stdin)
  for p in procs:
    if p.get('name') == 'odss-web':
      print(p.get('pm2_env',{}).get('status','unknown'))
      break
  else:
    print('not-found')
except:
  print('error')
" 2>/dev/null || echo "error")

  if [ "$WEB_STATUS" != "online" ]; then
    alert "odss-web is $WEB_STATUS — restarting..."
    pm2 restart odss-web --update-env 2>/dev/null || pm2 start ecosystem.config.cjs --only odss-web 2>/dev/null || true
    log "odss-web restarted"
  fi

  MARKET_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  procs = json.load(sys.stdin)
  for p in procs:
    if p.get('name') == 'odss-market':
      print(p.get('pm2_env',{}).get('status','unknown'))
      break
  else:
    print('not-found')
except:
  print('error')
" 2>/dev/null || echo "error")

  if [ "$MARKET_STATUS" != "online" ]; then
    alert "odss-market is $MARKET_STATUS — restarting..."
    pm2 restart odss-market --update-env 2>/dev/null || pm2 start ecosystem.config.cjs --only odss-market 2>/dev/null || true
    log "odss-market restarted"
  fi
fi

# 4. Check for errors in dev log (last 100 lines)
ERROR_COUNT=$(tail -100 "$PROJECT_DIR/dev.log" 2>/dev/null | grep -ciE "error|cannot find|module not found|undefined is not" || true)
ERROR_COUNT=${ERROR_COUNT:-0}
if [ "$ERROR_COUNT" -gt 5 ] 2>/dev/null; then
  alert "High error count in dev.log: $ERROR_COUNT errors in last 100 lines"
fi

log "Auto-commit check complete."
