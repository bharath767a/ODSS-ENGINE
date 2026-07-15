#!/bin/bash
set -euo pipefail

# ODSS RESTORE SCRIPT
# Usage: bash restore-odss.sh <backup-dir>
# Example: bash restore-odss.sh backups/pre-mentor-presentation

BACKUP_PATH="${1:-}"
if [ -z "$BACKUP_PATH" ]; then
  echo "Usage: bash restore-odss.sh <backup-dir>"
  echo "Available backups:"
  ls -d /home/z/my-project/backups/*/ 2>/dev/null | head -10
  exit 1
fi

PROJECT_DIR="/home/z/my-project"
export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

echo "=========================================="
echo "[$(date)] ODSS Restore from: $BACKUP_PATH"
echo "=========================================="

# 1. Stop services
echo "[1/6] Stopping services..."
pm2 stop all 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "bun --hot" 2>/dev/null || true
sleep 2

# 2. Restore source
echo "[2/6] Restoring source code..."
cd "$PROJECT_DIR"
if [ -f "$BACKUP_PATH/src.tar.gz" ]; then
  tar xzf "$BACKUP_PATH/src.tar.gz"
  echo "  ✓ Source restored"
fi

# 3. Restore database
echo "[3/6] Restoring database..."
if [ -f "$BACKUP_PATH/custom.db" ]; then
  mkdir -p db
  cp "$BACKUP_PATH/custom.db" db/custom.db
  echo "  ✓ Database restored"
fi

# 4. Restore env
echo "[4/6] Restoring environment..."
if [ -f "$BACKUP_PATH/env.backup" ]; then
  cp "$BACKUP_PATH/env.backup" .env
  echo "  ✓ Env restored"
fi

# 5. Install dependencies
echo "[5/6] Installing dependencies..."
bun install 2>&1 | tail -3
bun run db:push 2>&1 | tail -3

# 6. Start services
echo "[6/6] Starting services..."
pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart all --update-env
pm2 save 2>/dev/null || true

sleep 10
echo ""
echo "=========================================="
echo "Restore complete!"
echo "  Web: http://localhost:3000"
echo "  Gateway: http://localhost:81"
echo "=========================================="
pm2 list 2>/dev/null || true
