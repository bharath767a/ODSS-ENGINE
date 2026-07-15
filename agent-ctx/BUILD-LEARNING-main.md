# Task: BUILD-LEARNING — Learning Engine & Strategy Performance Tracker

**Agent:** main
**Task ID:** BUILD-LEARNING
**Status:** ✅ COMPLETE
**Date:** 2026-07-15

## Objective
Build the Learning Engine and Strategy Performance Tracker library modules for
the ODSS, plus the statistical-reliability primitives they depend on. These
modules track historical trade outcomes and provide statistical reliability
assessments (Wilson CI, tier classification, learning bias) and genetic-algorithm
strategy evolution.

## Prior Context Reviewed
- Read `/home/z/my-project/worklog.md` — prior agents built the full ODSS
  (22 phases), API routes (BUILD-D), and UI panels (BUILD-C, LAVENDER-RESTORE-FINAL).
- The 4 API routes (`/api/odss/learning`, `/api/odss/strategy-lab`, and the
  `/create` + `/evolve` POSTs) were already wired up by BUILD-D using
  **non-literal dynamic imports** so they gracefully fall back to
  `source: 'FALLBACK'` when the library modules are absent.
- My job: create the actual library modules so those routes flip from
  FALLBACK → real data.
- Prisma schema already defines `LearningPattern`, `StrategyVariant`, and
  `EvolutionLog` models (verified in `prisma/schema.prisma`).
- UI contracts (from `learning-panel.tsx` + `strategy-lab-panel.tsx`) drive
  the field names the list/stats functions must return.

## Files Created

### 1. `src/lib/odss/learning/statistical-reliability.ts` (pure, no DB)
Exports the full required surface:
- **Constants:** `PRELIMINARY_THRESHOLD=10`, `RELIABLE_THRESHOLD=30`,
  `CORRELATED_TRADE_DISCOUNT=0.15`, `WILSON_Z_80PCT=1.282`
- `calculateEffectiveN(rawN, correlatedTrades)` — multiplicative discount:
  `rawN × max(0, 1 − 0.15 × correlatedTrades)`. Clamped ≥ 0. Standard
  time-series effective-sample-size adjustment.
- `getReliabilityTier(effectiveN)` → `'INSUFFICIENT' | 'PRELIMINARY' | 'RELIABLE'`
  using the two thresholds.
- `getWinRateConfidenceInterval(wins, total, z=1.282)` — Wilson score 80% CI
  returning `{lower, upper}` as fractions in [0, 1]. Handles total=0 and
  extreme win rates (0%, 100%) correctly.
- `getLearningBias(effectiveN, winRatePct)` → `{delta, reason, tier}` where
  delta ∈ [−1, +1]:
  - INSUFFICIENT → 0
  - PRELIMINARY → `(winRatePct − 50) / 200`, capped ±0.3
  - RELIABLE → `(winRatePct − 50) / 100`, capped ±0.5
- `recomputePatternEffectiveN(pattern)` / `recomputeVariantEffectiveN(variant)`
  — defensive `any`-typed readers; pull `rawN` + optional `correlatedTrades`
  (defaults to 0 since the current schema doesn't persist that column).

### 2. `src/lib/odss/learning/learning-engine.ts` (Prisma `db`)
- `recordTradeOutcome({symbol, direction, pnl, rMultiple, context, variantGroup?, variantId?})`
  — upserts a LearningPattern keyed on
  `(symbol, direction, marketState, technicalTrend, sector, vixBand, dataRegime='REAL')`.
  Increments rawN/wins/losses, running-avg R, totalPnl; recomputes effectiveN,
  tier, winRatePct, Wilson CI; saves via `upsert` (race-safe).
- `lookupPattern({symbol, direction, context})` →
  `{effectiveN, tier, winRatePct, ciLower, ciUpper, avgR} | null`
- `listPatternsForCurrentRegime()` → all REAL-regime patterns, ordered by
  lastSeenAt desc then effectiveN desc.
- `getLearningStats()` → `{total, reliable, preliminary, insufficient}` via
  4 parallel `count()` queries.
- `backfillAllPatternEffectiveN()` — iterates all patterns, recomputes
  effectiveN + tier, persists. Idempotent; per-row errors logged not thrown.

**Key design decision — SQLite NULL-unique handling:** The composite unique on
LearningPattern includes 4 nullable fields (`marketState, technicalTrend,
sector, vixBand`). SQLite treats NULL as distinct in UNIQUE constraints, which
would break `findUnique`/`upsert` when those fields are absent. Solution: all
nullable key fields are normalised to `''` (empty string) before persistence
via a `normalizeKey()` helper. Empty strings are falsy for UI rendering and
make the composite unique behave correctly.

### 3. `src/lib/odss/learning/strategy-performance-tracker.ts` (Prisma `db`)
- `registerVariant({name, genome, parentName?})` → variant ID string. Creates
  StrategyVariant (status='CANDIDATE', generation=0, dataRegime='REAL') via
  `upsert` by `name`; emits an EvolutionLog `CREATE` entry only for genuinely
  new variants (pre-check avoids duplicate log spam on re-register).
- `recordVariantTrade({variantName, pnl, rMultiple, win})` — incremental
  update of rawN/wins/losses/avgR/totalPnl **plus a true running profitFactor**
  via GP/GL reconstruction (see below); recomputes effectiveN, tier,
  winRatePct, fitness.
- `listVariantsForCurrentRegime()` → all REAL-regime variants, ordered by
  effectiveN desc, fitness desc, lastSeenAt desc.
- `getStrategyLabStats()` → `{total, active, candidate, retired, graveyard}`.
- `createVariant(body?)` — generates a random name (`Greek-suffix-N`, e.g.
  `Lambda-X-3276`) + random genome JSON (strategy type, entry/exit/risk/
  position-sizing rules), honours optional body overrides (strategy, name,
  parentName), delegates to `registerVariant`. Returns `{variantId}`.
- `evolveVariants(body?)` → `{promoted, retired, pruned}`:
  1. PROMOTE CANDIDATE→ACTIVE if tier=RELIABLE & winRatePct>55
  2. RETIRE ACTIVE→RETIRED if tier=RELIABLE & winRatePct<40
  3. PRUNE (delete) GRAVEYARD variants older than 30 days — logs PRUNE to
     EvolutionLog *before* deleting so the audit trail survives.
  Each action emits an EvolutionLog entry with a JSON `details` payload.
- `getVariantDetail(name)` → full StrategyVariant row or null.
- Re-exports `calculateEffectiveN`, `getReliabilityTier`,
  `recomputeVariantEffectiveN` from statistical-reliability for convenience.

**Profit-factor reconstruction:** The schema persists `profitFactor` (a single
float) but not `grossProfit`/`grossLoss` separately. To still produce a *true
running* profit factor (Σ winning PnL ÷ |Σ losing PnL|) on each trade, I
reconstruct the previous (GP, GL) pair from the persisted
`(profitFactor, totalPnl)` using the identity:

```
PF = GP / GL
totalPnl = GP − GL
⇒  GL = totalPnl / (PF − 1),   GP = PF · GL
```

Then increment: `newGP = GP + max(pnl, 0)`, `newGL = GL + max(−pnl, 0)`,
`newPF = newGP / newGL` (capped at 99 when GL=0). Edge cases (no wins, no
losses, PF≈1, non-finite results) fall back to safe defaults. Verified
mathematically in the smoke test: 20 wins × ₹200 + 5 losses × ₹100 loss →
PF = 4000/500 = 8.0 exactly.

**Fitness formula** (per spec): `winRatePct × 0.4 + profitFactor × 0.3 + avgR × 0.3`.
Implemented literally. Verified: winRatePct=80, PF=8.0, avgR=0.7 →
32 + 2.4 + 0.21 = 34.61.

## Verification

### Lint
`bun run lint` → **0 errors, 1 warning** (pre-existing, in `nse-proxy/cloudflare-worker/nse-proxy.js`, unrelated).

### TypeScript
`npx tsc --noEmit` filtered to `src/lib/odss/learning/**` → **0 errors** in my 3 files.
(Pre-existing errors in other files: examples/, mini-services/, skills/, other odss modules — all unrelated.)

### End-to-end smoke test (89 assertions, ALL PASSED)
Wrote a one-off Bun script that exercised every exported function against the
real SQLite DB, then cleaned up after itself:

- **statistical-reliability (pure):** 25 assertions on constants, effectiveN
  (multiplicative discount + clamp), tier boundaries, Wilson CI bounds
  (including 0/0 and 10/10 edge cases), learning-bias delta math across all
  three tiers and cap boundaries.
- **learning-engine (DB):** recorded 4 trades (3W/1L) on a `TEST_SMOKE`
  pattern → verified lookup returns winRatePct=75, avgR=0.725, tier=INSUFFICIENT,
  effectiveN=4, valid CI bounds. Verified listPatternsForCurrentRegime,
  getLearningStats (tier counts sum to total), backfillAllPatternEffectiveN
  is idempotent. Cleaned up test rows.
- **strategy-performance-tracker (DB):** registered `SMOKE_TestVariant`,
  recorded 25 trades (20W/5L) → verified rawN=25, wins=20, losses=5,
  winRatePct=80, effectiveN=25, tier=PRELIMINARY, totalPnl=3500,
  **profitFactor=8.0** (GP/GL reconstruction exact), avgR=0.7,
  **fitness=34.61**. Pushed to 30 trades → tier=RELIABLE, winRatePct>55.
  Verified `createVariant({strategy:'LONG_PUT'})` produces a findable CANDIDATE
  row with the overridden strategy. Verified `evolveVariants` PROMOTEd the
  reliable+high-win variant (CANDIDATE→ACTIVE) with an EvolutionLog PROMOTE
  entry. Built a second variant with RELIABLE+winRate<40, manually set it to
  ACTIVE, evolved → RETIRED with log. Built a third GRAVEYARD variant with
  40-day-old updatedAt, evolved → PRUNEd (deleted) with surviving PRUNE log.
  Verified `getVariantDetail` happy + missing + empty-name paths. Cleaned up
  all SMOKE_ rows.

### Live API verification (post-fix, see below)
All 4 consuming endpoints now return real data instead of FALLBACK:
- `GET /api/odss/learning` → `source: LEARNING_ENGINE`, stats all 0 (no trades
  recorded yet — expected), patterns []
- `GET /api/odss/strategy-lab` → `source: STRATEGY_TRACKER`, stats
  `{total: 11, active: 0, candidate: 11, retired: 0, graveyard: 0}`, full
  variant list with genomes
- `POST /api/odss/strategy-lab/create` → `source: TRACKER`, returns real DB
  cuid `variantId` (e.g. `cmrll89dc0000rhx8sfveyd7y`)
- `POST /api/odss/strategy-lab/evolve` → `source: TRACKER`,
  `{promoted: 0, retired: 0, pruned: 0}` (correct — no variants meet
  RELIABLE+threshold yet since all have rawN=0)

## Environment Issue Found & Fixed

**Stale Prisma client in the running Next.js server.** When I first hit the
live endpoints, they returned `source: TRACKER` (proving the dynamic import
succeeded) but empty data — PM2's error log showed:
```
[strategy-tracker] registerVariant failed: TypeError: Cannot read properties of undefined (reading 'findUnique')
```
i.e. `db.strategyVariant` was `undefined` inside the running server. Root cause:
the `odss-web` PM2 process had started 23 min earlier with an older in-memory
Prisma client that pre-dated the LearningPattern/StrategyVariant/EvolutionLog
models being generated into `node_modules/.prisma/client`.

Fix:
1. `bunx prisma generate` → regenerated the client (writes new files into
   `node_modules/@prisma/client`).
2. `pm2 restart odss-web` → restarted the Next.js dev server so Node reloaded
   the fresh client.

After restart, all 4 endpoints return real DB data. No code change was needed —
this was purely an environment/process-cache issue. The 89-assertion smoke
test (run via standalone `bun run` script, fresh process) had passed all along,
confirming the code itself is correct.

## Architecture Notes
- All exported functions are `async` and wrap their bodies in try/catch with
  `console.error` logging + graceful fallback (return `''`/`null`/`[]`/zeroed
  stats). A failed learn-write or evolution pass never crashes a caller.
- `dataRegime` defaults to `'REAL'` everywhere (constant `REAL_REGIME`).
- `upsert` is used for both pattern and variant creation (race-safe against
  concurrent writers), per task spec.
- Nullable key fields normalised to `''` to defeat SQLite's NULL-distinct-in-
  UNIQUE behaviour.
- Profit factor is a *true running* ratio (not a win/loss-ratio proxy) thanks
  to the GP/GL reconstruction trick — exact to the rupee.
- Fitness, tier, winRatePct, effectiveN, Wilson CI all recomputed on every
  trade write so the DB columns are always internally consistent.
- The 4 consuming API routes (built by BUILD-D) required **zero changes** —
  their non-literal dynamic imports now resolve to real modules and the
  `source` field flips from `'FALLBACK'` to `'LEARNING_ENGINE'` /
  `'STRATEGY_TRACKER'` / `'TRACKER'` automatically.

## DB State After Work
- LearningPattern: 0 rows (no trades recorded yet — will populate as the
  trade state machine closes trades and calls `recordTradeOutcome`)
- StrategyVariant: 11 rows (10 pre-existing seed variants + 1 created during
  live API verification — `Lambda-X-3276`, BULL_CALL_SPREAD, CANDIDATE)
- EvolutionLog: 11 rows (10 pre-existing + 1 CREATE for the new variant)

## What's Next (suggestions for downstream agents)
- Wire `recordTradeOutcome` into the trade state-machine's `COMPLETE` transition
  (Phase 15) so patterns populate automatically as trades close.
- Wire `recordVariantTrade` into the paper-trading engine's trade-close path so
  variant stats update from real paper trades.
- Optionally schedule `evolveVariants` on a cron (e.g. daily EOD) so the
  strategy lab auto-evolves without manual button presses.
- If correlation tracking is needed later, add a `correlatedTrades Int @default(0)`
  column to LearningPattern/StrategyVariant — the `recompute*EffectiveN`
  functions already read it defensively and will pick it up with no code change.
