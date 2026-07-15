# BUILD-JOURNAL — Journal tab rebuild

Task ID: BUILD-JOURNAL
Agent: journal-builder
File touched: `src/components/odss/journal/journal-table.tsx` (complete rewrite, 1393 lines)

## What was built
Three-tab filter UI for the ODSS Journal:
1. **Active** — live trade from `useODSS().activeTrade`, wrapped into UnifiedClosedTrade shape and rendered with the full detail card + LIVE badge + pulsing green dot
2. **Positional** — open paper trades from `/api/odss/paper-trading/trades` (`open` array), each row expands inline to a PositionalDetail (live est P&L + TradeDetailCard)
3. **Closed** — merged closed trades from BOTH `/api/odss/journal` AND paper-trading `closed` array, sorted by exitTime DESC, each row expands inline to TradeDetailCard

Each expanded detail card shows:
- Header strip (symbol, dir, strategy, Net P&L large colored number)
- Quick stats strip (entry, exit, hold, R, outcome WIN ✓ / LOSS ✗)
- 2×2 grid of Section cards: Entry Details, Exit Details, P&L Breakdown (gross / costs / net), Risk Management (SL / TP1 / TP2 / TP3 with HIT highlight on TP1)
- R-multiple visual bar (centered 0R, -3R..+3R with tick marks, emerald/rose fill, 500ms transition)
- Market context tiles (Market State, VIX, Sector, Confidence)
- Entry/Exit reasons (JSON-parsed, bullet list with purple ▸ markers)
- AI explanation (live trades only)
- Tags as purple Badge pills

## Key design decisions
- UnifiedClosedTrade type bridges JournalTrade (no gross/costs) and PaperTrade (full breakdown). Journal trades show Gross: — / Costs: — since the TradeJournal schema only persists net pnl.
- SourceTag badge (PAPER=violet, JOURNAL=purple) on each closed row so origin is visible at a glance.
- CSS grid-rows 0fr→1fr trick for smooth height animation on expand (300ms ease-out + opacity). No JS height measurement.
- 12-col md+ grid for both header row and trade-row buttons; collapses to 4-col compact grid on mobile.
- Auto-refresh every 10s via setInterval; manual refresh button in card header.
- LAVENDER theme throughout: border-purple-100, bg-white/70, text-purple-600/700 accents, emerald/rose for P&L coloring.

## Verification
- `bun run lint` → 0 errors, 1 pre-existing nse-proxy warning (unrelated)
- `npx tsc --noEmit` filtered to journal-table.tsx → 0 errors
- Smoke-tested both data endpoints via curl: both return 200 OK with real data
- Dev server log clean — no compile errors

## Data flow
- `useODSS().activeTrade` — LiveTrade (WebSocket snapshot, port 3002 via XTransformPort)
- `GET /api/odss/journal` — TradeJournal rows (Prisma)
- `GET /api/odss/paper-trading/trades` — {open: PaperTrade[], closed: PaperTrade[]}

No changes needed to:
- `src/app/page.tsx` (already wires JournalTable into the journal tab)
- `src/app/api/odss/journal/route.ts`
- `src/app/api/odss/paper-trading/trades/route.ts`
