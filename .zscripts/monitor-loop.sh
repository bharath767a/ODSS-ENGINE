#!/bin/bash
# Background monitor loop — runs auto-commit every 5 minutes
# Started by start-odss.sh, survives via nohup

export PATH="$PATH:/home/z/.npm-global/bin:/usr/local/bin"

while true; do
  bash /home/z/my-project/.zscripts/auto-commit.sh 2>/dev/null || true
  sleep 300  # 5 minutes
done
