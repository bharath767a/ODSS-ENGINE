/**
 * ODSS - Validation Report Generator (Milestone 2)
 *
 * Analyzes a recorded session and produces a ValidationReport:
 *
 * 1. Decision distribution (how many ENTER/WAIT/WATCH/AVOID)
 * 2. Decision stability (flip-flop rate)
 * 3. ENTER win rate (did price reach TP1 before SL?)
 * 4. Average R-multiple (if all ENTERs were taken)
 * 5. Engine contribution (which engines drove the best decisions)
 * 6. Best/worst opportunities
 *
 * This is the "evidence" the user asked for — it tells you which
 * rules actually work and which add complexity without benefit.
 */
import { db } from '@/lib/db';
import { getSymbolMeta } from '../universe';

export async function generateValidationReport(sessionId: string): Promise<any> {
  const session = await db.replaySession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Session not found');

  const scans = await db.replayScan.findMany({
    where: { sessionId },
    orderBy: { scanNumber: 'asc' },
  });

  const ticks = await db.replayTick.findMany({
    where: { sessionId },
    orderBy: { tickNumber: 'asc' },
  });

  if (scans.length === 0) {
    throw new Error('No scans in session.');
  }

  // 1. Decision distribution
  let totalEnter = 0;
  let totalWait = 0;
  let totalWatch = 0;
  let totalAvoid = 0;
  const decisionsBySymbol = new Map<string, string[]>();

  for (const scan of scans) {
    if (scan.topDecision === 'ENTER') totalEnter++;
    else if (scan.topDecision === 'WAIT') totalWait++;
    else if (scan.topDecision === 'WATCH') totalWatch++;
    else if (scan.topDecision === 'AVOID') totalAvoid++;

    if (scan.topSymbol) {
      if (!decisionsBySymbol.has(scan.topSymbol)) {
        decisionsBySymbol.set(scan.topSymbol, []);
      }
      decisionsBySymbol.get(scan.topSymbol)!.push(scan.topDecision ?? 'UNKNOWN');
    }
  }

  // 2. Decision stability (flip-flop rate)
  let totalFlips = 0;
  let totalPossibleFlips = 0;
  const stabilityBySymbol = new Map<string, number>();

  for (const [symbol, decisions] of decisionsBySymbol) {
    let flips = 0;
    for (let i = 1; i < decisions.length; i++) {
      if (decisions[i] !== decisions[i - 1]) flips++;
    }
    totalFlips += flips;
    totalPossibleFlips += decisions.length - 1;
    stabilityBySymbol.set(symbol, decisions.length > 1 ? 1 - flips / (decisions.length - 1) : 1);
  }

  const avgStability = totalPossibleFlips > 0 ? 1 - totalFlips / totalPossibleFlips : 1;

  // 3. ENTER win rate — for each ENTER decision, check if price reached TP1 before SL
  // We need to trace forward from each ENTER scan to see what happened to the price.
  let enterWinCount = 0;
  let enterLossCount = 0;
  let totalR = 0;
  let enterOutcomeCount = 0;
  const enterOutcomes: { symbol: string; scanNum: number; outcome: string; rMultiple: number }[] = [];

  for (const scan of scans) {
    if (scan.topDecision !== 'ENTER' || !scan.topSymbol) continue;

    const recs = JSON.parse(scan.recommendations || '[]');
    const rec = recs.find((r: any) => r.symbol === scan.topSymbol);
    if (!rec || !rec.entry || !rec.risk) continue;

    const entry = rec.risk.entry;
    const sl = rec.risk.stopLoss;
    const tp1 = rec.risk.tp1;
    const direction = rec.direction;
    const scanTick = scan.tickNumber;

    // Find ticks after this scan
    const futureTicks = ticks.filter((t) => t.tickNumber > scanTick).slice(0, 100); // next 100 ticks (~5 min)
    if (futureTicks.length === 0) continue;

    let hitTP1 = false;
    let hitSL = false;
    let exitPrice = entry;
    const isLong = direction === 'CE';

    for (const tick of futureTicks) {
      const quotes = JSON.parse(tick.quotes);
      const symQuote = quotes[scan.topSymbol];
      if (!symQuote) continue;
      const price = symQuote.ltp;

      if (isLong) {
        if (price >= tp1) { hitTP1 = true; exitPrice = tp1; break; }
        if (price <= sl) { hitSL = true; exitPrice = sl; break; }
      } else {
        if (price <= tp1) { hitTP1 = true; exitPrice = tp1; break; }
        if (price >= sl) { hitSL = true; exitPrice = sl; break; }
      }
    }

    // If neither hit, use the last price
    if (!hitTP1 && !hitSL && futureTicks.length > 0) {
      const lastQuotes = JSON.parse(futureTicks[futureTicks.length - 1].quotes);
      exitPrice = lastQuotes[scan.topSymbol]?.ltp ?? entry;
    }

    const slDistance = Math.abs(entry - sl);
    const rMultiple = slDistance > 0
      ? (isLong ? (exitPrice - entry) : (entry - exitPrice)) / slDistance
      : 0;

    if (hitTP1) { enterWinCount++; enterOutcomes.push({ symbol: scan.topSymbol, scanNum: scan.scanNumber, outcome: 'WIN', rMultiple }); }
    else if (hitSL) { enterLossCount++; enterOutcomes.push({ symbol: scan.topSymbol, scanNum: scan.scanNumber, outcome: 'LOSS', rMultiple }); }
    else { enterOutcomes.push({ symbol: scan.topSymbol, scanNum: scan.scanNumber, outcome: 'NEUTRAL', rMultiple }); }

    totalR += rMultiple;
    enterOutcomeCount++;
  }

  const enterWinRate = enterOutcomeCount > 0 ? (enterWinCount / enterOutcomeCount) * 100 : 0;
  const enterLossRate = enterOutcomeCount > 0 ? (enterLossCount / enterOutcomeCount) * 100 : 0;
  const avgRMultiple = enterOutcomeCount > 0 ? totalR / enterOutcomeCount : 0;

  // 4. Engine contribution — which engines voted ENTER on winning trades vs losing trades?
  const engineStats = new Map<string, { enterOnWin: number; enterOnLoss: number; enterOnNeutral: number }>();
  for (const outcome of enterOutcomes) {
    const scan = scans.find((s) => s.scanNumber === outcome.scanNum);
    if (!scan) continue;
    const recs = JSON.parse(scan.recommendations || '[]');
    const rec = recs.find((r: any) => r.symbol === outcome.symbol);
    if (!rec?.decision?.votes) continue;

    for (const vote of rec.decision.votes) {
      if (vote.vote === 'ENTER') {
        if (!engineStats.has(vote.engine)) {
          engineStats.set(vote.engine, { enterOnWin: 0, enterOnLoss: 0, enterOnNeutral: 0 });
        }
        const stat = engineStats.get(vote.engine)!;
        if (outcome.outcome === 'WIN') stat.enterOnWin++;
        else if (outcome.outcome === 'LOSS') stat.enterOnLoss++;
        else stat.enterOnNeutral++;
      }
    }
  }

  const engineContribution: Record<string, { winRate: number; totalEnters: number }> = {};
  for (const [engine, stat] of engineStats) {
    const total = stat.enterOnWin + stat.enterOnLoss + stat.enterOnNeutral;
    engineContribution[engine] = {
      winRate: total > 0 ? (stat.enterOnWin / total) * 100 : 0,
      totalEnters: total,
    };
  }

  // 5. Best/worst opportunities
  let bestOpp: { symbol: string; score: number } | null = null;
  for (const scan of scans) {
    if (scan.topScore && (!bestOpp || scan.topScore > bestOpp.score)) {
      bestOpp = { symbol: scan.topSymbol ?? '', score: scan.topScore };
    }
  }

  const worstDecisions = enterOutcomes
    .filter((o) => o.outcome === 'LOSS')
    .sort((a, b) => a.rMultiple - b.rMultiple)
    .slice(0, 3);

  const worstDecision = worstDecisions.length > 0
    ? worstDecisions.map((d) => `${d.symbol}@scan${d.scanNum} (${d.rMultiple.toFixed(2)}R)`).join(', ')
    : 'No losing ENTER decisions';

  // Persist the report
  const report = await db.validationReport.create({
    data: {
      sessionId,
      totalScans: scans.length,
      totalEnter,
      totalWait,
      totalWatch,
      totalAvoid,
      avgStability,
      flipCount: totalFlips,
      enterWinRate,
      enterLossRate,
      avgRMultiple,
      engineContribution: JSON.stringify(engineContribution),
      bestOpportunity: bestOpp ? `${bestOpp.symbol} (${bestOpp.score.toFixed(0)})` : null,
      worstDecision,
    },
  });

  return {
    reportId: report.id,
    sessionId,
    sessionName: session.name,
    sessionDate: session.startTime,
    duration: session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0,
    tickCount: session.tickCount,
    scanCount: session.scanCount,
    // Decision distribution
    decisions: {
      ENTER: totalEnter,
      WAIT: totalWait,
      WATCH: totalWatch,
      AVOID: totalAvoid,
    },
    // Stability
    stability: {
      avgStability: (avgStability * 100).toFixed(1) + '%',
      flipCount: totalFlips,
      stabilityBySymbol: Array.from(stabilityBySymbol.entries())
        .map(([symbol, s]) => ({ symbol, stability: (s * 100).toFixed(1) + '%' }))
        .sort((a, b) => parseFloat(a.stability) - parseFloat(b.stability))
        .slice(0, 10),
    },
    // ENTER outcomes
    enterOutcomes: {
      total: enterOutcomeCount,
      wins: enterWinCount,
      losses: enterLossCount,
      winRate: enterWinRate.toFixed(1) + '%',
      lossRate: enterLossRate.toFixed(1) + '%',
      avgRMultiple: avgRMultiple.toFixed(2) + 'R',
      details: enterOutcomes,
    },
    // Engine contribution
    engineContribution,
    // Summary
    bestOpportunity: bestOpp ? `${bestOpp.symbol} (score ${bestOpp.score.toFixed(0)})` : 'N/A',
    worstDecision,
    regimeHistory: session.regimeHistory ? JSON.parse(session.regimeHistory) : [],
  };
}

export async function getValidationReport(sessionId: string) {
  const report = await db.validationReport.findFirst({
    where: { sessionId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!report) return null;
  return {
    ...report,
    engineContribution: report.engineContribution ? JSON.parse(report.engineContribution) : {},
  };
}
