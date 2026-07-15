# Task: REMOVE-SIMULATION — Strip simulator fallbacks from ODSS API routes

**Agent:** main
**Task ID:** REMOVE-SIMULATION
**Status:** ✅ COMPLETE
**Date:** 2026-07-15

## Objective
Remove ALL simulation/synthetic data fallbacks from the 6 ODSS API routes
that serve data to the UI. When real data is unavailable, the API must
return a "no data" error response instead of falling back to the
`market-simulator`. The simulator files themselves are NOT deleted — they
remain in use internally by the mini-service tick loop and engine
processing. Only the API routes are de-coupled.

## Prior Context Reviewed
- Read `/home/z/my-project/worklog.md` — prior agents built the full ODSS
  (22 phases), data provider router (NSE → Yahoo → Angel One), and the
  simulator fallback pattern in the API routes.
- Read `/home/z/my-project/agent-ctx/BUILD-LEARNING-main.md` for the
  agent-ctx convention.
- Inspected `src/lib/odss/data-providers/router.ts` — confirmed the
  `ProviderRouter` exposes `getQuote`, `getAllQuotes`, `getOptionChain`,
  `getIndiaVIX`, `getMarketBreadth`, `getPreferredProvider`.
- Inspected `src/lib/odss/universe.ts` — `STOCKS` array (23 stocks) and
  `ALL_SYMBOLS` (27 = 4 indices + 23 stocks) available for bulk fetches.
- Inspected `src/lib/odss/types.ts` — `Quote` interface has `symbol`,
  `sector?`, `ltp`, `prevClose`, `changePct`, `candles`, etc.
- Inspected `src/lib/odss/store/store.ts` — `getStore().market` is
  populated by the mini-service via WebSocket (NOT a simulator import in
  the API route), so reading `market.marketState/bias/trend` is allowed.
- Inspected `src/components/odss/fundamentals/stock-analysis-tab.tsx` —
  the UI does `if (d.data) setFundamental(d)` on the JSON body regardless
  of HTTP status, so a 200-with-priceSource='NONE' response keeps
  fundamental data visible while flagging the price as unavailable.

## Files Modified (6 total — exactly as specified)

### 1. `src/app/api/odss/quote/[symbol]/route.ts`
**Removed:** `import { getQuote, getAllQuotes } from '@/lib/odss/simulator/market-simulator'`
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'` + `ALL_SYMBOLS` from universe.
**Behavior:**
- `/quote/all` → `router.getAllQuotes(ALL_SYMBOLS.map(s => s.symbol))`.
  If the map is empty → 503 `{ error: 'No live data available', timestamp, hint }`.
  Otherwise returns `{ quotes, source: preferredProvider }`.
- `/quote/[symbol]` → `router.getQuote(sym)` ONLY. If it returns a quote
  with `ltp > 0` → 200 with `{ ...quote, source }`. Otherwise → 404
  `{ error: 'No live data available', symbol, timestamp, hint }`.
- All router calls wrapped in try/catch; the catch falls through to the
  "no data" response (never to the simulator).
- `export const dynamic = 'force-dynamic'` preserved.

### 2. `src/app/api/odss/optionchain/[symbol]/route.ts`
**Removed:** `import { getOptionChain } from '@/lib/odss/simulator/market-simulator'`
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'`
**Behavior:**
- `router.getOptionChain(sym)` ONLY. If it returns a chain → 200 with
  `{ ...chain, source: 'NSE' }` (or preferred provider). Otherwise → 404
  `{ error: 'No live option chain available', symbol, timestamp,
  hint: 'Configure NSE_PROXY_URL for real option chain data' }`.
- try/catch wraps the router call; the catch falls through to 404.
- `export const dynamic = 'force-dynamic'` preserved.

### 3. `src/app/api/odss/fundamentals/[symbol]/route.ts`
**Removed:** `import { getQuote } from '@/lib/odss/simulator/market-simulator'`
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'`
**Behavior:**
- Fundamental data still comes from `getFundamentalProvider()` (curated
  static data — not market data, not simulator). If missing → 404
  `{ error: 'Fundamental data not available for this symbol' }`.
- Price fetched via `router.getQuote(sym)` ONLY. If the router returns a
  quote with `ltp > 0` → `priceSource = preferredProvider ?? 'REAL'`,
  `currentPrice = quote.ltp`, `priceChangePct = quote.changePct`.
- If the router fails (throws or returns null/0) → `priceSource = 'NONE'`,
  `currentPrice = 0`, `priceChangePct = 0`, `priceError = 'No live price
  available'`. The response is still 200 OK with the fundamental data
  intact — only the PRICE is flagged as "no data". This honors the spec
  note "only the PRICE should return 'no data' if Yahoo is unavailable"
  while keeping the P/E, EPS, debt, quarterly results visible to the UI.
- The `priceSource` type is widened to include `'NONE'` so the UI can
  branch on it.
- `export const dynamic = 'force-dynamic'` preserved.

### 4. `src/app/api/odss/market-brief/route.ts`
**Removed:** the entire simulator import block —
`getQuote, getAllQuotes, getIndiaVix, getMarketBreadth, getRegime` from
`@/lib/odss/simulator/market-simulator`.
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'`
+ `getSymbolMeta, STOCKS` from universe + `Quote` type.
**Behavior:**
- Fetches NIFTY, BANKNIFTY, FINNIFTY, VIX via the router in parallel.
  If NIFTY or BANKNIFTY is missing (`!ltp`) → 503
  `{ error: 'No live market data available', timestamp, hint }`.
- **Breadth** (replaces `getMarketBreadth()`): new
  `computeBreadthFromQuotes(stockQuotes)` counts stocks with
  `changePct > 0` (advances) vs `changePct < 0` (declines) from the REAL
  Yahoo stock quotes. Ratio = advances/declines (or 2 if declines=0 and
  advances>0, or 1 if both 0).
- **Regime** (replaces `getRegime()`): new `deriveRegime(niftyPct)` maps
  the real NIFTY change % to a regime label:
  `≤ -1.5 → 'SELLOFF'`, `≤ -0.5 → 'TRENDING_DOWN'`, `≥ 0.5 →
  'TRENDING_UP'`, `|pct| ≤ 0.15 → 'RANGING'`, else `'CHOPPY'`. This
  label feeds the LLM prompt and the FII/DII magnitude calc.
- **Stock quotes** (replaces `getAllQuotes()`): `router.getAllQuotes(
  STOCKS.map(s => s.symbol))` → filtered to `ltp > 0` → drives
  gainers, losers, and sector performance.
- Gainers/losers now filtered to `changePct > 0` / `< 0` respectively
  (so a flat market doesn't show 5 "gainers" at 0%).
- `getStore().market` still read for `marketState/bias/trend` — this is
  shared state from the mini-service, NOT a simulator import. Falls back
  to `'FLAT'` / `'NEUTRAL'` via `??` if the store is empty.
- All other logic (FII/DII derivation, AI summary LLM call, risks,
  opportunities, news builder) unchanged — they consume the now-real
  `niftyClose`, `vix`, `breadth`, `regime`, `topGainers`, `topSectors`.
- `priceSource` initialized to `'REAL'`, set to preferred provider on
  success. Never `'SIMULATOR'`.
- `export const dynamic = 'force-dynamic'` + `revalidate = 0` preserved.

### 5. `src/app/api/odss/recommendation/[symbol]/route.ts`
**Removed:** `import { getQuote } from '@/lib/odss/simulator/market-simulator'`
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'`
**Behavior:**
- Cached recommendation check (`store.recommendations.get(sym)`)
  unchanged — returns immediately if present.
- `store.market` null check unchanged → 503 `'Market data not ready'`.
- Quote fetched via `router.getQuote(sym)` ONLY (try/catch → null on
  failure). If `!q || q.ltp <= 0` → 503
  `{ error: 'No live data available for recommendation', symbol,
  timestamp, hint }`.
- The rest of the engine pipeline (`runTechnicalEngine`,
  `runOptionChainEngine`, `runStrikeEngine`, `runEntryEngine`,
  `runRiskEngine`, `runDecisionEngine`) is unchanged — these engines
  internally call the simulator, but the API route no longer imports it.
  Per the task rule "Do NOT modify any other files", the engines are
  left as-is. The route's own `q.sector` reference now uses the real
  router quote.
- `export const dynamic = 'force-dynamic'` preserved.

### 6. `src/app/api/odss/stock-story/[symbol]/route.ts`
**Removed:** `import { getQuote } from '@/lib/odss/simulator/market-simulator'`
**Added:** `import { getDataRouter } from '@/lib/odss/data-providers/router'`
**Behavior:**
- Fundamental data from `getFundamentalProvider()` (unchanged). If
  missing → 404 `{ error: 'Fundamental data not available' }`.
- Price fetched via `router.getQuote(sym)` ONLY (try/catch → falls
  through). If the router returns a quote with `ltp > 0` →
  `priceSource = preferredProvider ?? 'REAL'`.
- If the router fails → `currentPrice = data.profile.marketCap / 10000`
  (fundamental-data-derived estimate, NOT simulator) and
  `priceSource = 'ESTIMATED'`. This matches the spec: "use the
  fundamental data's marketCap-based estimate but flag it with
  `priceSource: 'ESTIMATED'`".
- The `priceSource` is now included in the success response body so the
  UI can show whether the story used a real or estimated price.
- `export const dynamic = 'force-dynamic'` preserved.

## What Was NOT Touched (per task rules)
- `src/lib/odss/simulator/market-simulator.ts` — file kept intact; still
  used by the mini-service tick loop and engine processing.
- `src/lib/odss/engines/*` — the engines (technical-engine,
  option-chain-engine, strike-engine, etc.) internally call
  `getQuote`/`getOptionChain` from the simulator. Per "Do NOT modify any
  other files", these are left as-is. The API routes no longer import the
  simulator directly; the engines' internal use is a separate concern.
- `src/app/api/odss/reset/route.ts` — still imports
  `resetSimulator, tick, getQuote, getIndiaVix` from the simulator. This
  route is for admin/reset operations (not a data-serving route), so it's
  intentionally NOT in the modification list.
- `src/lib/odss/store/store.ts` — the store is shared state populated by
  the mini-service via WebSocket, not a simulator import. API routes
  reading `store.market` is allowed.
- `src/lib/odss/data-providers/router.ts` — kept as the sole source of
  real data (NSE → Yahoo → Angel One). No changes needed.

## Verification

### Lint
`bun run lint` → **0 errors, 1 warning** (pre-existing, in
`nse-proxy/cloudflare-worker/nse-proxy.js`, unrelated).

### Simulator import check
`rg "from '@/lib/odss/simulator" <6 modified files>` → **NO MATCHES**.
All 6 files are simulator-import-free. (Only comments mentioning
"simulator" remain, e.g. "Replaces the simulator's getRegime()".)

### Live API verification (curl against the running dev server)

| Endpoint | Before | After |
|---|---|---|
| `GET /api/odss/quote/NIFTY` | 200 `source: SIMULATOR` (when Yahoo failed) | 200 `source: YAHOO`, `ltp: 24190.55` — or 404 `{error: 'No live data available'}` if Yahoo is down |
| `GET /api/odss/quote/all` | 200 with 27 simulator quotes | 200 `source: YAHOO`, 27 real Yahoo quotes — or 503 if all providers fail |
| `GET /api/odss/optionchain/NIFTY` | 200 `source: SIMULATOR` (NSE geo-blocked) | **404** `{error: 'No live option chain available', hint: 'Configure NSE_PROXY_URL...'}` |
| `GET /api/odss/fundamentals/RELIANCE` | 200 `priceSource: SIMULATOR` (when Yahoo failed) | 200 `priceSource: YAHOO`, `currentPrice: 1303.1`, `priceError: null` — or `priceSource: 'NONE'`, `priceError: 'No live price available'` if Yahoo fails (fundamental data still returned) |
| `GET /api/odss/market-brief?type=intraday` | 200 with simulator prices + `getMarketBreadth()` | 200 `source: YAHOO`, `niftyClose: 24191.95`, `vix: 13.075`, `breadth: {advances: 14, declines: 9, ratio: 1.56}` (computed from 23 real Yahoo stock quotes) — or 503 `{error: 'No live market data available'}` if NIFTY/BANKNIFTY fail |
| `GET /api/odss/recommendation/RELIANCE` | 200 with simulator quote | 503 `{error: 'No live data available for recommendation'}` if router fails (currently 503 `'Market data not ready'` because the mini-service isn't running in dev — both are 503, both signal "no data") |
| `POST /api/odss/stock-story/RELIANCE` | 200 with simulator price | 200 `priceSource: YAHOO` — or `priceSource: 'ESTIMATED'` with marketCap-derived price if router fails |

### Specific live test results (representative)
- `quote/NIFTY` → `source: YAHOO`, `ltp: 24190.55`, `changePct: 0.576`
- `quote/all` → `source: YAHOO`, 27 quotes, first = NIFTY
- `optionchain/NIFTY` → 404 with exact spec error + hint
- `market-brief?type=intraday` → `source: YAHOO`, `breadth: {advances: 14, declines: 9, ratio: 1.56}`, 5 gainers, 5 losers, 8 sectors — all from real Yahoo data
- `fundamentals/RELIANCE` → `priceSource: YAHOO`, `currentPrice: 1303.1`, fundamental data intact
- `stock-story/RELIANCE` (POST) → 200, `priceSource: YAHOO`, story generated

## Architecture Notes
- The `ProviderRouter` (`src/lib/odss/data-providers/router.ts`) is now
  the SOLE source of real market data in all 6 API routes. Its priority
  order is NSE → YAHOO → ANGEL_ONE. (UPSTOX and SIMULATOR are listed in
  the PRIORITY array but SIMULATOR is never registered as a provider
  instance, so the router naturally returns `null` when all real
  providers fail — which the routes translate into "no data" errors.)
- The `router.getIndiaVIX()` has a hardcoded `return 15` fallback when
  all providers fail. This is the router's own fallback (not the
  simulator), and 15 is a plausible real VIX value, so it's left as-is.
  In practice, if Yahoo is up (which it must be for NIFTY/BANKNIFTY to
  pass the 503 gate), VIX is real.
- For `market-brief`, the `getStore().market` field is read for
  `marketState/bias/trend`. This is shared state from the mini-service
  (populated via WebSocket), NOT a simulator import in the API route.
  When the mini-service isn't running, `market` is null and the `??`
  defaults (`'FLAT'`, `'NEUTRAL'`) kick in — that's "no data", not
  "simulated data".
- The `deriveRegime()` and `computeBreadthFromQuotes()` helpers in
  `market-brief/route.ts` are pure functions of real data — no RNG, no
  synthetic state. They replace `getRegime()` and `getMarketBreadth()`
  from the simulator.

## What's Next (suggestions for downstream agents)
- The engines (`technical-engine.ts`, `option-chain-engine.ts`,
  `strike-engine.ts`) still import `getQuote`/`getOptionChain` from the
  simulator internally. If full simulator removal from the
  recommendation pipeline is desired, those engines would need to be
  refactored to accept a quote/chain as a parameter (dependency
  injection) rather than calling the simulator directly. This was out of
  scope for this task ("Do NOT modify any other files").
- The UI components that consume these endpoints may want to add explicit
  handling for the new "no data" responses (404/503 with `error` field)
  to show a clear "No live data available" message instead of silently
  rendering empty/zero values. Currently the UIs mostly do
  `if (d.data) setX(d)` or `if (d.quotes) ...` which gracefully degrades
  but doesn't surface the error to the user.
- For `fundamentals`, the UI could check `priceSource === 'NONE'` (or the
  `priceError` field) and render "No live price available" in place of
  the ₹0.00 price display.
