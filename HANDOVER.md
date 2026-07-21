# ODSS Engine — Complete Handover Package

## Project Overview
ODSS (Options Decision Support System) is a real-time intraday options trading analysis engine for the Indian NSE market. It analyzes 93 F&O stocks every 5 seconds and generates conviction-based picks with multi-layer ranking.

## Current State (as of July 21, 2026)

### What's Working ✅
1. **Real-time data flow**: Yahoo Finance (quotes + VIX) + Dhan API (option chains + greeks via bridge)
2. **Bridge Server v4**: Python FastAPI bridge on user's India laptop, connects Dhan + AngelOne + Yahoo
3. **Organized Dashboard**: NIFTY permanent benchmark + CE/PE side-by-side + News Shockers
4. **Conviction DNA Engine**: 5-layer ranking (Elo + Bayesian + track record + confluence lock + survivorship)
5. **Market Regime Classifier**: TRENDING/CHOPPY/HIGH_VOL/LOW_VOL with conviction multipliers
6. **Time Window Quality**: Scores each 15-min window (amateur hour, trend window, etc.)
7. **Intraday Confluence**: 3-vector technical score (CVD 5m + Options 15m + VWAP 1h)
8. **Active Trades Tracking**: Take Trade button, greeks display, decision stability (5-rule system)
9. **Market Session Guard**: Engine freezes when market closed (no after-hours shuffling)
10. **Ranking Stabilizer**: 3-layer hysteresis prevents pick shuffling
11. **News Intelligence**: RSS feeds archived every 5 min with entity extraction + sentiment
12. **Paper Trading**: ₹500k virtual portfolio with Black-Scholes pricing

### Known Issues ⚠️
1. **Dhan credentials**: Stored in `/home/z/odss-data/dhan-config.json` (sandbox) and `C:\nse-bridge\dhan-creds.json` (laptop). Both are git-ignored.
2. **Daily token refresh**: Dhan access token expires every 24 hours. Run `python dhan-login.py` each morning.
3. **ngrok URL changes**: Free ngrok tier gives new URL on restart. Update `bridge-config.json` when it changes.
4. **Conviction picks**: May show 0 when market is closed (by design — engine frozen)
5. **Confluence VWAP 1h**: Shows NO_DATA for first hour after engine start (needs 1h of candle history)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  India Laptop (Windows)                              │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │ bridge_server   │    │ Dhan API                │ │
│  │ _v4.py          │───▶│ (quotes + option chains │ │
│  │ (FastAPI:8765)  │    │  + greeks + OI)         │ │
│  └────────┬────────┘    └─────────────────────────┘ │
│           │                                            │
│  ┌────────▼────────┐                                  │
│  │ ngrok tunnel    │                                  │
│  │ (HTTPS URL)     │                                  │
│  └────────┬────────┘                                  │
└───────────┼─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────┐
│  Cloud Sandbox (Linux)                               │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │ BridgeProvider  │───▶│ ngrok URL               │ │
│  │ (TypeScript)    │    │ (bridge-config.json)    │ │
│  └────────┬────────┘    └─────────────────────────┘ │
│           │                                            │
│  ┌────────▼────────┐    ┌─────────────────────────┐ │
│  │ YahooProvider   │    │ Yahoo Finance API       │ │
│  │ (fallback)      │───▶│ (quotes + VIX + candles)│ │
│  └────────┬────────┘    └─────────────────────────┘ │
│           │                                            │
│  ┌────────▼──────────────────────────────────────┐  │
│  │ Market Service (port 3002)                    │  │
│  │  - Scans 93 F&O stocks every 5s              │  │
│  │  - Runs all engines (conviction, DNA, etc.)  │  │
│  │  - Broadcasts via Socket.IO                   │  │
│  └────────┬──────────────────────────────────────┘  │
│           │                                            │
│  ┌────────▼──────────────────────────────────────┐  │
│  │ Web Server (port 3000, Next.js 16)            │  │
│  │  - Dashboard with organized CE/PE layout      │  │
│  │  - Real-time updates via WebSocket            │  │
│  │  - Active Trades panel with greeks            │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## File Structure

### Core Engine (`src/lib/odss/`)
- `orchestrator.ts` — Main scan loop, runs all engines in order
- `types.ts` — Shared TypeScript types
- `universe.ts` — 93 F&O stock symbols + metadata
- `market-session.ts` — NSE market hours detection (freezes engine when closed)
- `config.ts` — User configuration (DB-backed)

### Engines (`src/lib/odss/engines/`)
- `conviction-engine.ts` — 5 picks + watchlist with hysteresis + top-3 freeze
- `conviction-dna.ts` — 5-layer ranking (Elo + Bayesian + track record + confluence + survivorship)
- `ranking-stabilizer.ts` — Prevents pick shuffling (3-layer hysteresis)
- `regime-classifier.ts` — Market regime detection (TRENDING/CHOPPY/HIGH_VOL/LOW_VOL)
- `time-window.ts` — Intraday time quality scoring (amateur hour, trend window, etc.)
- `intraday-confluence.ts` — 3-vector technical (CVD 5m + Options 15m + VWAP 1h)
- `active-trades-engine.ts` — Tracks user's taken trades with decision stability
- `market-engine.ts` — Market trend/structure/volatility
- `sector-engine.ts` — Sector momentum
- `relative-strength-engine.ts` — Stock vs market RS
- `opportunity-engine.ts` — Combines all engines into opportunity score
- `technical-engine.ts` — RSI, MACD, VWAP, EMA indicators
- `option-chain-engine.ts` — PCR, OI analysis, max pain
- `strike-engine.ts` — ATM strike selection
- `entry-engine.ts` — Entry zone + signal generation
- `risk-engine.ts` — Stop loss, target, R:R
- `decision-engine.ts` — ENTER/WAIT/AVOID decision
- `exit-engine.ts` — Exit score (CONTINUE/TRAIL/REDUCE/EXIT)
- `trade-management-engine.ts` — Active trade management
- `guardrails-engine.ts` — Daily loss limits, trade count limits
- `stability-tracker.ts` — Decision flip-flop detection
- `smart-money-bias.ts` — FII/DII positioning (not yet integrated)
- `squeeze-detector.ts` — Short covering squeeze detection (not yet integrated)

### Data Providers (`src/lib/odss/data-providers/`)
- `router.ts` — Provider priority: DHAN > BRIDGE > YAHOO > NSE > ANGEL_ONE
- `dhan-provider.ts` — Direct Dhan API (for sandbox, if network allows)
- `bridge-provider.ts` — Routes through bridge on laptop (via ngrok)
- `yahoo-provider.ts` — Free Yahoo Finance (quotes + VIX + candles)
- `angelone-provider.ts` — Direct AngelOne (not used, bridge handles this)
- `nse-provider.ts` — Direct NSE (geo-blocked from sandbox)
- `types.ts` — Provider interface + rate limiter

### Dashboard (`src/components/odss/dashboard/`)
- `opportunity-table.tsx` — Main CE/PE side-by-side picks display
- `confluence-card.tsx` — 3-vector technical card (CVD/OPTS/VWAP)
- `current-trade-card.tsx` — Active trade display + AI Decision Analysis
- `ai-explainer.tsx` — AI explanation panel
- `market-overview.tsx` — Market brief + VIX + breadth
- `sector-grid.tsx` — Sector heatmap
- `decision-log.tsx` — Engine decision history
- `engine-votes-panel.tsx` — Engine vote breakdown
- `guardrail-bar.tsx` — Daily loss/trade limits
- `recommendation-drawer.tsx` — Detailed stock analysis drawer
- `sparkline.tsx` — Mini price chart
- `ticker-tape.tsx` — Scrolling price ticker

### Bridge Server (`nse-bridge/`)
- `bridge_server_v4.py` — FastAPI bridge (Dhan + AngelOne + Yahoo)
- `dhan-login.py` — Daily OAuth token generator
- `dhan-creds-template.json` — Credential template (user fills in)
- `dhan-creds.json` — GIT-IGNORED (actual credentials)

### Mini Services (`mini-services/odss-market/`)
- `index.ts` — Market service (Socket.IO server on port 3002)
- Scans every 5s, broadcasts via WebSocket
- Fetches real data from Yahoo + Bridge

### Data Files (`/home/z/odss-data/`) — OUTSIDE project folder
- `engine-state.json` — Current engine state (conviction, recommendations, etc.)
- `quotes.json` — Latest quotes for 93 symbols
- `conviction-state.json` — Conviction engine persisted state
- `conviction-dna.json` — DNA engine persisted state (Elo, survivorship, etc.)
- `ranking-stabilizer.json` — Ranking stabilizer persisted state
- `news-archive.json` — Archived news with entity extraction
- `bridge-config.json` — Bridge URL + token
- `dhan-config.json` — Dhan credentials (GIT-IGNORED)
- `custom.db` — SQLite database (trades, journal, config)
- `archive/` — Permanent data archive (quotes, candles, option chains)
- `pm2-logs/` — PM2 process logs

## Setup Instructions for New Agent

### 1. Environment
- Next.js 16 with App Router
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Prisma ORM + SQLite
- PM2 process manager
- Bun runtime (for mini-service)

### 2. Install Dependencies
```bash
cd /home/z/my-project
bun install
cd mini-services/odss-market
bun install socket.io
```

### 3. Database
```bash
cd /home/z/my-project
bun run db:push
```

### 4. Start Services
```bash
pm2 start ecosystem.config.cjs
# OR manually:
bun run dev  # web server on port 3000
cd mini-services/odss-market && bun run dev  # market service on port 3002
```

### 5. Bridge Setup (on India laptop)
1. Install Python 3.12+ + pip
2. `pip install fastapi uvicorn requests pyotp`
3. Create `dhan-creds.json` with Dhan credentials
4. Run `python dhan-login.py` (generates access token)
5. Run `python bridge_server_v4.py` (starts bridge on port 8765)
6. Run `ngrok http 8765` (creates tunnel)
7. Update `bridge-config.json` on sandbox with ngrok URL

### 6. Credentials (SECURITY)
- Dhan credentials: `/home/z/odss-data/dhan-config.json` (sandbox) + `nse-bridge/dhan-creds.json` (laptop)
- Both files are in `.gitignore` — NEVER commit them
- Access token expires every 24 hours — run `dhan-login.py` daily

## Key Design Decisions

1. **Yahoo for quotes, Bridge for option chains**: Yahoo is more reliable for basic quotes. Bridge (Dhan) is used for option chains + greeks. This ensures data always flows even if bridge goes down.

2. **Market session guard**: Engine freezes when market is closed. Prevents pick shuffling during off-hours. Resumes automatically at 09:00 IST.

3. **Conviction DNA**: Picks earn their rank through reputation (Elo), not just current score. Proven picks become sticky (+30 survivorship credit). New picks must prove themselves.

4. **3-layer ranking stability**: 
   - Layer 1: Ranking stabilizer (8-point promotion margin, 4-scan confirmation)
   - Layer 2: Conviction engine hysteresis (promotion at 55, demotion at 40, 3-5 scan confirmation)
   - Layer 3: DNA effective score (Elo + Bayesian + survivorship)

5. **Organized dashboard**: Always shows CE/PE side-by-side + NIFTY permanent + News Shockers. Uses conviction picks first, fills from topRecommendations if needed.

## Pending Development

### High Priority
1. **Integrate smart-money-bias.ts**: FII/DII positioning data from NSE (daily CSV at 6:30 PM IST)
2. **Integrate squeeze-detector.ts**: Short covering detection from option chain OI
3. **Real option chain parsing**: Bridge returns Dhan option chains, but BridgeProvider needs to parse them correctly
4. **Dhan WebSocket streaming**: Replace 10s polling with real-time WebSocket for zero-latency data

### Medium Priority
5. **Option chain for individual stocks**: Currently only NIFTY/BANKNIFTY option chains work
6. **Delivery volume analysis**: End-of-day delivery data for institutional tracking
7. **Order block detection**: Needs 1-minute candle data (currently 5s scan interval)
8. **Backtesting engine**: Replay recorded sessions with strategy variants

### Low Priority
9. **Mobile responsive optimization**: Dashboard works on mobile but could be better
10. **Multi-user support**: Currently single-user, could add authentication
11. **Alert system**: Push notifications for entry/exit signals
12. **Broker integration**: Connect to broker for actual order placement (currently analysis only)

## API Endpoints

### REST API (port 3000)
- `GET /api/odss/state` — Full engine state
- `GET /api/odss/health` — Provider health status
- `GET /api/odss/market-session` — NSE market session status
- `GET /api/odss/taken-trades` — Active trades list
- `POST /api/odss/taken-trades` — Mark trade as taken
- `DELETE /api/odss/taken-trades?symbol=XXX` — Exit trade
- `GET /api/odss/recommendation/[symbol]` — Individual stock recommendation
- `GET /api/odss/optionchain/[symbol]` — Option chain data
- `POST /api/odss/explain/[symbol]` — AI explanation (LLM)
- `GET /api/odss/bridge-config` — Bridge configuration
- `GET /api/odss/analytics` — Performance analytics

### WebSocket (port 3002)
- `odss:snapshot` — Full state on connect
- `odss:update` — State update every scan (5s)
- `market:tick` — Live price updates (3s)
- `active-trades:update` — Active trades update (5s)
- `confluence:update` — Confluence scores update (5s)
- `optionchain:update` — Option chain for focused symbol (3s)

### Bridge API (port 8765, via ngrok)
- `GET /health` — Bridge status (no auth)
- `GET /quote/{symbol}` — Live quote (Dhan → Yahoo fallback)
- `POST /quotes/batch` — Batch quotes (max 50 symbols)
- `GET /options/{underlying}` — Option chain with OI + Greeks (Dhan)
- `GET /indices` — NIFTY/BANKNIFTY/FINNIFTY quotes
- All endpoints require `X-Bridge-Token` header (except /health)

## ⚠️ CRITICAL INSTRUCTION FOR THE NEW DEVELOPER

**DO NOT rebuild or rewrite the dashboard.** This is a WORKING, PRODUCTION system. Your job is to:
1. **Continue development** from the current state
2. **Fix bugs** in the existing code
3. **Add features** to the existing codebase
4. **Integrate** the pending items (smart-money-bias, squeeze-detector, real option chains)

The dashboard is LIVE and WORKING. The user (bharath767a) is actively trading with it. Do NOT:
- ❌ Create a new Next.js project
- ❌ Rewrite the dashboard components
- ❌ Change the architecture
- ❌ Remove existing features

DO:
- ✅ Clone this repo and run it as-is
- ✅ Read the code to understand the existing logic
- ✅ Make incremental improvements
- ✅ Test changes before pushing

---

## How to Access the Archive Data (914 MB)

The archive folder (`/home/z/odss-data/archive/`) contains historical data that is TOO LARGE for GitHub (914 MB). It has 3 subfolders:

```
archive/
├── historical/    ← 10 years of daily candles for all 93 stocks
├── optionchains/  ← Historical option chain snapshots
└── quotes/        ← Historical intraday quote snapshots
```

### Option A: The Archive Auto-Rebuilds (Recommended)

The engine **automatically rebuilds the archive** from scratch on a fresh server:
1. On startup, `fetchAndArchiveHistorical()` downloads 10 years of daily candles from Yahoo Finance for all 93 symbols
2. Every 10 seconds, `archiveLiveQuotes()` saves current quotes to `archive/quotes/`
3. Every scan, option chains are saved to `archive/optionchains/`

**You don't need the old archive.** The engine will rebuild it automatically. Just:
```bash
# After starting the engine, wait 10-15 minutes for the initial download
pm2 logs odss-market --lines 20 | grep "Historical"
# You should see: "Historical data archived: XX symbols"
```

### Option B: Get the Archive from the Current Server

If you want the existing 914 MB archive immediately (instead of waiting for it to rebuild):

**The user (bharath767a) can provide it via:**
1. **Google Drive / Dropbox** — User compresses the archive and uploads it
2. **Direct server access** — User gives you SSH access to the current sandbox

To compress and download from the current sandbox:
```bash
# On the current sandbox:
cd /home/odss-data
tar -czf archive.tar.gz archive/
# This creates a ~100-200MB compressed file
# Download it via the file explorer or SCP
```

Then on the new server:
```bash
# Upload archive.tar.gz to the new server
mkdir -p /home/odss-data
cd /home/odss-data
tar -xzf archive.tar.gz
# The archive is now ready
```

### Option C: Start Fresh (Simplest)

The archive is NOT required for the engine to work. It's only used for:
- Long-term backtesting
- Historical fundamental analysis
- Strategy performance tracking

**The engine works perfectly without the archive.** It will rebuild it automatically over time. If you just want to get started quickly:
```bash
mkdir -p /home/odss-data/archive/historical
mkdir -p /home/odss-data/archive/optionchains
mkdir -p /home/odss-data/archive/quotes
# Done — engine will populate these folders automatically
```

---

## Setup Instructions for New Developer

### Step 1: Clone the Repository
```bash
git clone https://github.com/bharath767a/ODSS-ENGINE.git
cd ODSS-ENGINE
```

### Step 2: Install Dependencies
```bash
bun install
cd mini-services/odss-market && bun install socket.io && cd ..
```

### Step 3: Create Data Directory
```bash
mkdir -p /home/odss-data/archive/historical
mkdir -p /home/odss-data/archive/optionchains
mkdir -p /home/odss-data/archive/quotes

# Copy data snapshot files (from the repo's data-snapshot/ folder)
cp data-snapshot/engine-state.json /home/odss-data/
cp data-snapshot/quotes.json /home/odss-data/
cp data-snapshot/conviction-state.json /home/odss-data/
cp data-snapshot/news-archive.json /home/odss-data/
cp data-snapshot/bridge-config.json /home/odss-data/
```

### Step 4: Create Database
```bash
bun run db:push
```

### Step 5: Set Up Dhan Credentials
The user will provide these privately. Create the credential files:
```bash
# On the server (for direct Dhan API if needed):
cat > /home/odss-data/dhan-config.json << 'EOF'
{
  "clientId": "PROVIDED_BY_USER",
  "apiKey": "PROVIDED_BY_USER",
  "apiSecret": "PROVIDED_BY_USER",
  "accessToken": "GENERATED_DAILY_VIA_DHAN_LOGIN_PY"
}
EOF

# On the bridge machine (India laptop or server):
cat > nse-bridge/dhan-creds.json << 'EOF'
{
  "clientId": "PROVIDED_BY_USER",
  "apiKey": "PROVIDED_BY_USER",
  "apiSecret": "PROVIDED_BY_USER",
  "accessToken": "GENERATED_DAILY_VIA_DHAN_LOGIN_PY"
}
EOF
```

### Step 6: Start the Bridge (on India laptop or server)
```bash
cd nse-bridge
pip install fastapi uvicorn requests pyotp
python dhan-login.py    # Generate daily access token
python bridge_server_v4.py  # Start bridge on port 8765
```

### Step 7: Start ngrok (for bridge tunnel)
```bash
ngrok http 8765
# Copy the HTTPS URL
# Update /home/odss-data/bridge-config.json with the new URL
```

### Step 8: Start the Engine
```bash
# Using PM2 (recommended):
pm2 start ecosystem.config.cjs

# OR manually:
bun run dev  # Web server on port 3000
cd mini-services/odss-market && bun run dev  # Market service on port 3002
```

### Step 9: Verify It's Working
```bash
# Check services:
pm2 list

# Check data flowing:
curl -s http://localhost:3000/api/odss/state | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('VIX:', d.get('market', {}).get('indiaVix'))
print('Quotes:', len(d.get('topRecommendations', [])))
"

# Check dashboard:
# Open http://localhost:3000 in browser
```

### Step 10: Understand the Current State
Read these files to understand what's already built:
1. `HANDOVER.md` (this file) — Architecture + setup
2. `src/lib/odss/orchestrator.ts` — Main scan loop
3. `src/lib/odss/engines/conviction-dna.ts` — 5-layer ranking system
4. `src/components/odss/dashboard/opportunity-table.tsx` — Main dashboard component
5. `mini-services/odss-market/index.ts` — Market service (Socket.IO)

---

## What's Working Right Now (July 21, 2026)

### Live Data Flow
- **Yahoo Finance**: 93 F&O stocks + India VIX (updates every 10s)
- **Dhan Bridge**: Option chains + greeks (via ngrok tunnel to India laptop)
- **News**: 5 RSS feeds archived every 5 min with entity extraction

### Dashboard Features
- NIFTY 50 BENCHMARK card (permanent, always shows)
- CE BULLISH PICKS + PE BEARISH PICKS (side by side)
- NEWS SHOCKERS section (when active)
- Confluence cards (CVD 5m + Options 15m + VWAP 1h)
- Active Trades panel with greeks + decision stability
- AI Decision Analysis (rule-based, not LLM per scan)
- Market status banner (OPEN/CLOSED/PRE-OPEN)
- Take Trade button on each pick

### Engine Intelligence
- Conviction DNA (Elo + Bayesian + track record + confluence + survivorship)
- Market Regime Classifier (TRENDING/CHOPPY/HIGH_VOL/LOW_VOL)
- Time Window Quality (amateur hour, trend window, square-off zone)
- Ranking Stabilizer (prevents pick shuffling)
- Market Session Guard (freezes engine when market closed)
- Decision Stability (5-rule system: cooldown + confirmation + hysteresis)

### What the User Does Every Morning
1. Start bridge on India laptop: `python bridge_server_v4.py`
2. Start ngrok: `ngrok http 8765`
3. If ngrok URL changed, update `bridge-config.json` on sandbox
4. Refresh dashboard at 09:20 IST — picks appear within 2-3 min

---

## Contact
- GitHub: https://github.com/bharath767a/ODSS-ENGINE.git
- User: bharath767a
- Original developer: Z.ai Code (AI agent)
- Dhan credentials: Provided privately by user (NOT in git)
