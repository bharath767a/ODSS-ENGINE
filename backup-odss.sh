#!/bin/bash
set -euo pipefail

# ============================================================
# ODSS BACKUP SCRIPT
# ============================================================
# Creates a complete backup of the ODSS project:
#   1. Git snapshot (all committed work)
#   2. Source code tarball (including uncommitted changes)
#   3. Database backup
#   4. PM2 process state
#   5. Environment config
#
# Usage: bash backup-odss.sh [backup-name]
# Default: backup-odss-YYYYMMDD-HHMMSS
# ============================================================

PROJECT_DIR="/home/z/my-project"
BACKUP_DIR="/home/z/my-project/backups"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_NAME="${1:-backup-odss-$TIMESTAMP}"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

echo "=========================================="
echo "[$(date)] ODSS Backup: $BACKUP_NAME"
echo "=========================================="

mkdir -p "$BACKUP_PATH"

# 1. Git snapshot
echo "[1/5] Creating git snapshot..."
cd "$PROJECT_DIR"
git bundle create "$BACKUP_PATH/git-repo.bundle" --all 2>/dev/null || true
git log --oneline -20 > "$BACKUP_PATH/git-log.txt"
echo "  ✓ Git bundle + log saved"

# 2. Source code tarball (excluding node_modules, .next, db)
echo "[2/5] Creating source tarball..."
tar czf "$BACKUP_PATH/src.tar.gz" \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='db/*.db' \
  --exclude='backups' \
  --exclude='tool-results' \
  --exclude='*.log' \
  src/ \
  mini-services/ \
  prisma/ \
  public/ \
  ecosystem.config.cjs \
  next.config.ts \
  package.json \
  bun.lock \
  tsconfig.json \
  tailwind.config.ts \
  Caddyfile \
  .env \
  start-odss.sh \
  .zscripts/ \
  2>/dev/null || true
echo "  ✓ Source tarball saved"

# 3. Database backup
echo "[3/5] Backing up database..."
if [ -f "$PROJECT_DIR/db/custom.db" ]; then
  cp "$PROJECT_DIR/db/custom.db" "$BACKUP_PATH/custom.db"
  echo "  ✓ Database saved"
else
  echo "  ⚠ No database file found"
fi

# 4. PM2 process state
echo "[4/5] Saving PM2 state..."
pm2 save 2>/dev/null || true
cp /home/z/.pm2/dump.pm2 "$BACKUP_PATH/pm2-dump.pm2" 2>/dev/null || true
pm2 list > "$BACKUP_PATH/pm2-status.txt" 2>/dev/null || true
echo "  ✓ PM2 state saved"

# 5. Environment + config
echo "[5/5] Saving environment config..."
cp "$PROJECT_DIR/.env" "$BACKUP_PATH/env.backup" 2>/dev/null || true
cp "$PROJECT_DIR/ecosystem.config.cjs" "$BACKUP_PATH/" 2>/dev/null || true
cp "$PROJECT_DIR/Caddyfile" "$BACKUP_PATH/" 2>/dev/null || true
echo "  ✓ Config saved"

# Create manifest
cat > "$BACKUP_PATH/MANIFEST.md" << EOF
# ODSS Backup: $BACKUP_NAME
Created: $(date)

## Contents
- git-repo.bundle — Full git history (git bundle)
- git-log.txt — Last 20 commits
- src.tar.gz — Source code (excluding node_modules, .next, db)
- custom.db — SQLite database
- pm2-dump.pm2 — PM2 process state
- pm2-status.txt — PM2 status at backup time
- env.backup — .env file
- ecosystem.config.cjs — PM2 ecosystem config
- Caddyfile — Gateway config

## Restore Instructions
1. Extract src.tar.gz to project directory
2. Restore .env from env.backup
3. Run: bun install
4. Run: bun run db:push
5. Restore database: cp custom.db db/custom.db
6. Start: pm2 start ecosystem.config.cjs
7. Or: pm2 resurrect (uses pm2-dump.pm2)
EOF

echo ""
echo "=========================================="
echo "Backup complete: $BACKUP_PATH"
echo "Size: $(du -sh "$BACKUP_PATH" | cut -f1)"
echo "=========================================="
ls -la "$BACKUP_PATH/"
