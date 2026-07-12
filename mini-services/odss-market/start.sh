#!/bin/bash
# Start the ODSS market mini-service in the background
cd /home/z/my-project/mini-services/odss-market
pkill -f "odss-market/index" 2>/dev/null
sleep 1
# Fully detach: nohup + setsid + redirect all FDs
nohup setsid bun run dev > service.log 2>&1 < /dev/null &
echo $! > service.pid
disown $! 2>/dev/null
echo "Started odss-market, pid=$(cat service.pid)"
