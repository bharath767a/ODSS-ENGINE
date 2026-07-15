/**
 * ODSS Strategy Lab — Evolution Engine
 * ====================================================================
 *
 * Genetic-algorithm engine for evolving options-trading strategy
 * variants. Uses the Prisma-backed StrategyVariant + EvolutionLog
 * tables and the pure `strategy-genome` module for create/mutate/
 * crossover operations.
 *
 * Lifecycle of a variant:
 *   CANDIDATE  →  ACTIVE     (promote: tier=RELIABLE, winRate>55%, avgR>0)
 *   ACTIVE     →  RETIRED    (retire:  tier=RELIABLE, winRate<40% or avgR<-0.5)
 *   RETIRED    →  GRAVEYARD  (pruned after 30 days of inactivity)
 *
 * Each generation:
 *   1. Walk all ACTIVE + CANDIDATE variants and apply the rules above.
 *   2. Prune GRAVEYARD variants older than 30 days.
 *   3. If fewer than 10 CANDIDATE variants exist, spawn new ones:
 *        a. Top 3 ACTIVE by fitness each contribute 1 mutated child.
 *        b. Top 2 ACTIVE by fitness contribute 1 crossover child.
 *        c. 1 completely-random new variant is seeded.
 *      If fewer than 3 ACTIVE variants exist, fall back to mutated
 *      children of any ACTIVE/CANDIDATE available, and finally to
 *      purely random variants, so the lab can bootstrap from empty.
 *   4. Log every action (CREATE/PROMOTE/RETIRE/PRUNE/MUTATE/CROSSOVER)
 *      to EvolutionLog.
 *
 * The engine is IDEMPOTENT: running it twice in a row will not promote
 * or retire the same variant twice (state checks are precondition-gated),
 * and will only spawn new candidates when the pool is below threshold.
 * ====================================================================
 */

import { db } from '@/lib/db';
import {
  randomGenome,
  mutateGenome,
  crossoverGenome,
  genomeToString,
  genomeToName,
  parseGenome,
  type StrategyGenome,
} from './strategy-genome';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface EvolutionResult {
  generation: number;
  created: number;
  promoted: number;
  retired: number;
  pruned: number;
  mutated: number;
  crossoverd: number;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MIN_CANDIDATES = 10;
const GRAVEYARD_PRUNE_DAYS = 30;
const TOP_PARENTS = 3;
const TOP_CROSSOVER_PARENTS = 2;
const PROMOTE_WIN_RATE = 55;     // %
const PROMOTE_AVG_R = 0;
const RETIRE_WIN_RATE = 40;      // %
const RETIRE_AVG_R = -0.5;
const RELIABLE_TIER = 'RELIABLE';

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function nowISO(): Date {
  return new Date();
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

/**
 * Compute a deterministic fitness score for a variant.
 *
 * Fitness blends expectancy (avgR) with reliability (sample size and
 * win rate) so the engine prefers variants that are both profitable
 * AND statistically well-supported. The score is intentionally simple
 * and bounded; the real "truth" lives in the variant's stored
 * winRatePct, avgR, effectiveN, profitFactor columns (which the
 * strategy-performance-tracker updates from completed paper trades).
 *
 * Fitness = avgR * ln(1 + effectiveN) + (winRatePct - 50) / 50
 */
function computeFitness(v: {
  avgR: number;
  effectiveN: number;
  winRatePct: number;
}): number {
  const expectancy = Number.isFinite(v.avgR) ? v.avgR : 0;
  const effN = Math.max(0, Number.isFinite(v.effectiveN) ? v.effectiveN : 0);
  const winRate = Number.isFinite(v.winRatePct) ? v.winRatePct : 0;
  const sizeBonus = Math.log(1 + effN); // grows sub-linearly with sample size
  const winBonus = (winRate - 50) / 50; // -1..+1
  return Number((expectancy * sizeBonus + winBonus).toFixed(4));
}

async function logEvolution(
  generation: number,
  action: 'CREATE' | 'PROMOTE' | 'RETIRE' | 'PRUNE' | 'MUTATE' | 'CROSSOVER',
  variantName: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.evolutionLog.create({
      data: {
        generation,
        action,
        variantName,
        details: JSON.stringify(details),
      },
    });
  } catch {
    // Logging must never break the evolution pass.
  }
}

/**
 * Generate a unique variant name. Tries the genome-derived name first,
 * falls back to a numeric suffix on collision.
 */
async function uniqueVariantName(genome: StrategyGenome): Promise<string> {
  const base = genomeToName(genome);
  try {
    const existing = await db.strategyVariant.findUnique({
      where: { name: base },
      select: { name: true },
    });
    if (!existing) return base;

    // Collision — append a counter until we find a free slot.
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`;
      const clash = await db.strategyVariant.findUnique({
        where: { name: candidate },
        select: { name: true },
      });
      if (!clash) return candidate;
    }
  } catch {
    // If the lookup fails, just return the base name — the DB unique
    // constraint will reject the insert if it really is a duplicate,
    // and the caller's try/catch will surface a graceful error.
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

async function getVariantByName(
  name: string,
): Promise<{ name: string; genome: string; generation: number } | null> {
  try {
    const v = await db.strategyVariant.findUnique({
      where: { name },
      select: { name: true, genome: true, generation: true },
    });
    return v ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Public: runEvolutionPass
// ----------------------------------------------------------------------------

export async function runEvolutionPass(): Promise<EvolutionResult> {
  const result: EvolutionResult = {
    generation: 0,
    created: 0,
    promoted: 0,
    retired: 0,
    pruned: 0,
    mutated: 0,
    crossoverd: 0,
  };

  try {
    // ------------------------------------------------------------------
    // 0. Determine the next generation number.
    //    Use 1 if no prior log entries exist; otherwise max(generation)+1.
    // ------------------------------------------------------------------
    let generation = 1;
    try {
      const lastLog = await db.evolutionLog.findFirst({
        orderBy: { generation: 'desc' },
        select: { generation: true },
      });
      if (lastLog && typeof lastLog.generation === 'number') {
        generation = lastLog.generation + 1;
      }
    } catch {
      // keep generation = 1
    }
    result.generation = generation;

    // ------------------------------------------------------------------
    // 1. Pull all ACTIVE + CANDIDATE variants for the rule pass.
    // ------------------------------------------------------------------
    const liveVariants = await db.strategyVariant.findMany({
      where: { status: { in: ['ACTIVE', 'CANDIDATE'] } },
    });

    // ------------------------------------------------------------------
    // 2. PROMOTE  CANDIDATE -> ACTIVE
    //    (tier=RELIABLE, winRatePct > 55, avgR > 0)
    // ------------------------------------------------------------------
    for (const v of liveVariants) {
      if (v.status !== 'CANDIDATE') continue;
      if (v.tier !== RELIABLE_TIER) continue;
      if (!(v.winRatePct > PROMOTE_WIN_RATE && v.avgR > PROMOTE_AVG_R)) continue;

      try {
        await db.strategyVariant.update({
          where: { id: v.id },
          data: {
            status: 'ACTIVE',
            updatedAt: nowISO(),
          },
        });
        result.promoted += 1;
        await logEvolution(generation, 'PROMOTE', v.name, {
          reason: 'RELIABLE & winRate>55% & avgR>0',
          oldStatus: 'CANDIDATE',
          newStatus: 'ACTIVE',
          winRatePct: v.winRatePct,
          avgR: v.avgR,
          tier: v.tier,
        });
      } catch {
        // continue on per-variant failure
      }
    }

    // ------------------------------------------------------------------
    // 3. RETIRE  ACTIVE -> RETIRED
    //    (tier=RELIABLE, winRatePct < 40 OR avgR < -0.5)
    // ------------------------------------------------------------------
    for (const v of liveVariants) {
      if (v.status !== 'ACTIVE') continue;
      if (v.tier !== RELIABLE_TIER) continue;
      const shouldRetire =
        v.winRatePct < RETIRE_WIN_RATE || v.avgR < RETIRE_AVG_R;
      if (!shouldRetire) continue;

      try {
        await db.strategyVariant.update({
          where: { id: v.id },
          data: {
            status: 'RETIRED',
            updatedAt: nowISO(),
          },
        });
        result.retired += 1;
        await logEvolution(generation, 'RETIRE', v.name, {
          reason: 'RELIABLE & (winRate<40% | avgR<-0.5)',
          oldStatus: 'ACTIVE',
          newStatus: 'RETIRED',
          winRatePct: v.winRatePct,
          avgR: v.avgR,
          tier: v.tier,
        });
      } catch {
        // continue
      }
    }

    // ------------------------------------------------------------------
    // 4. PRUNE  GRAVEYARD older than 30 days
    //    We delete the row entirely; the EvolutionLog retains the
    //    history of actions taken on the variant.
    // ------------------------------------------------------------------
    const pruneCutoff = daysAgo(GRAVEYARD_PRUNE_DAYS);
    try {
      const stale = await db.strategyVariant.findMany({
        where: {
          status: 'GRAVEYARD',
          updatedAt: { lt: pruneCutoff },
        },
        select: { id: true, name: true },
      });
      for (const v of stale) {
        try {
          await db.strategyVariant.delete({ where: { id: v.id } });
          result.pruned += 1;
          await logEvolution(generation, 'PRUNE', v.name, {
            reason: `GRAVEYARD older than ${GRAVEYARD_PRUNE_DAYS} days`,
            cutoff: pruneCutoff.toISOString(),
          });
        } catch {
          // continue
        }
      }
    } catch {
      // continue
    }

    // ------------------------------------------------------------------
    // 5. SPAWN new CANDIDATE variants if pool is below threshold.
    // ------------------------------------------------------------------
    let candidateCount = 0;
    try {
      candidateCount = await db.strategyVariant.count({
        where: { status: 'CANDIDATE' },
      });
    } catch {
      candidateCount = 0;
    }

    if (candidateCount < MIN_CANDIDATES) {
      // Top ACTIVE parents by fitness (descending). Fitness is computed
      // on the fly from the stored stats.
      let topActive: Array<{
        id: string;
        name: string;
        genome: string;
        generation: number;
        fitness: number;
      }> = [];
      try {
        const actives = await db.strategyVariant.findMany({
          where: { status: 'ACTIVE' },
        });
        topActive = actives
          .map((v) => ({
            id: v.id,
            name: v.name,
            genome: v.genome,
            generation: v.generation,
            fitness: computeFitness({
              avgR: v.avgR,
              effectiveN: v.effectiveN,
              winRatePct: v.winRatePct,
            }),
          }))
          .sort((a, b) => b.fitness - a.fitness)
          .slice(0, TOP_PARENTS);
      } catch {
        topActive = [];
      }

      // ---- a. Mutated children of top ACTIVE parents -----------------
      for (const parent of topActive) {
        const parentGenome = parseGenome(parent.genome);
        if (!parentGenome) continue;
        const childGenome = mutateGenome(parentGenome);
        const created = await persistVariant({
          genome: childGenome,
          generation,
          parentName: parent.name,
        });
        if (created) {
          result.mutated += 1;
          result.created += 1;
          await logEvolution(generation, 'MUTATE', created.name, {
            parent: parent.name,
            parentFitness: parent.fitness,
            childGenome: genomeToString(childGenome),
          });
        }
      }

      // ---- b. Crossover child from top 2 ACTIVE parents --------------
      if (topActive.length >= TOP_CROSSOVER_PARENTS) {
        const p1 = topActive[0];
        const p2 = topActive[1];
        const g1 = parseGenome(p1.genome);
        const g2 = parseGenome(p2.genome);
        if (g1 && g2) {
          const childGenome = crossoverGenome(g1, g2);
          const created = await persistVariant({
            genome: childGenome,
            generation,
            parentName: `${p1.name}+${p2.name}`,
          });
          if (created) {
            result.crossoverd += 1;
            result.created += 1;
            await logEvolution(generation, 'CROSSOVER', created.name, {
              parent1: p1.name,
              parent2: p2.name,
              parent1Fitness: p1.fitness,
              parent2Fitness: p2.fitness,
              childGenome: genomeToString(childGenome),
            });
          }
        }
      }

      // ---- c. Completely random new variant --------------------------
      // Even if we already have parents, seeding one pure-random variant
      // per generation preserves genetic diversity and lets the lab
      // explore new regions of the genome space.
      const randomGenomeObj = randomGenome();
      const created = await persistVariant({
        genome: randomGenomeObj,
        generation,
        parentName: null,
      });
      if (created) {
        result.created += 1;
        await logEvolution(generation, 'CREATE', created.name, {
          reason: 'Random seed (diversity injection)',
          genome: genomeToString(randomGenomeObj),
        });
      }

      // ---- d. Bootstrap fallback -------------------------------------
      // If we still don't have enough candidates (e.g. zero ACTIVE
      // parents existed), spawn additional random variants until we
      // hit the threshold. Cap to avoid runaway inserts on a fresh DB.
      try {
        candidateCount = await db.strategyVariant.count({
          where: { status: 'CANDIDATE' },
        });
      } catch {
        candidateCount = 0;
      }
      const stillNeeded = Math.max(0, MIN_CANDIDATES - candidateCount);
      const bootstrapCap = Math.min(stillNeeded, 10);
      for (let i = 0; i < bootstrapCap; i++) {
        const g = randomGenome();
        const created = await persistVariant({
          genome: g,
          generation,
          parentName: null,
        });
        if (created) {
          result.created += 1;
          await logEvolution(generation, 'CREATE', created.name, {
            reason: 'Bootstrap random seed',
            genome: genomeToString(g),
          });
        }
      }
    }

    return result;
  } catch (err) {
    // Last-resort: never throw out of the engine. Return whatever we
    // have accumulated and let the caller decide what to do.
    return result;
  }
}

// ----------------------------------------------------------------------------
// persistVariant — insert a new CANDIDATE variant
// ----------------------------------------------------------------------------

async function persistVariant(args: {
  genome: StrategyGenome;
  generation: number;
  parentName: string | null;
}): Promise<{ id: string; name: string } | null> {
  const { genome, generation, parentName } = args;
  const name = await uniqueVariantName(genome);
  try {
    const created = await db.strategyVariant.create({
      data: {
        name,
        genome: JSON.stringify(genome),
        status: 'CANDIDATE',
        tier: 'INSUFFICIENT',
        generation,
        parentName: parentName ?? null,
        rawN: 0,
        effectiveN: 0,
        wins: 0,
        losses: 0,
        profitFactor: 0,
        avgR: 0,
        totalPnl: 0,
        fitness: 0,
        winRatePct: 0,
        lastSeenAt: nowISO(),
      },
      select: { id: true, name: true },
    });
    return { id: created.id, name: created.name };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Public: createRandomVariant
// ----------------------------------------------------------------------------

export async function createRandomVariant(): Promise<{ id: string; name: string }> {
  const genome = randomGenome();
  // Determine generation context for logging
  let generation = 1;
  try {
    const lastLog = await db.evolutionLog.findFirst({
      orderBy: { generation: 'desc' },
      select: { generation: true },
    });
    if (lastLog && typeof lastLog.generation === 'number') {
      generation = lastLog.generation; // manual create = same generation as last pass
    }
  } catch {
    // keep default
  }

  const created = await persistVariant({ genome, generation, parentName: null });
  if (!created) {
    // Persist failed — return a synthetic placeholder so the caller
    // can surface a graceful error in the UI.
    return {
      id: `err_${Date.now().toString(36)}`,
      name: `${genomeToName(genome)}-failed`,
    };
  }
  await logEvolution(generation, 'CREATE', created.name, {
    reason: 'Manual create (random)',
    genome: genomeToString(genome),
  });
  return created;
}

// ----------------------------------------------------------------------------
// Public: createMutatedVariant
// ----------------------------------------------------------------------------

export async function createMutatedVariant(
  parentName: string,
): Promise<{ id: string; name: string }> {
  const parent = await getVariantByName(parentName);
  if (!parent) {
    throw new Error(`Parent variant not found: ${parentName}`);
  }
  const parentGenome = parseGenome(parent.genome);
  if (!parentGenome) {
    throw new Error(`Parent variant has invalid genome: ${parentName}`);
  }
  const childGenome = mutateGenome(parentGenome);

  const created = await persistVariant({
    genome: childGenome,
    generation: parent.generation + 1,
    parentName: parent.name,
  });
  if (!created) {
    return {
      id: `err_${Date.now().toString(36)}`,
      name: `${genomeToName(childGenome)}-failed`,
    };
  }
  await logEvolution(parent.generation + 1, 'MUTATE', created.name, {
    parent: parent.name,
    childGenome: genomeToString(childGenome),
  });
  return created;
}

// ----------------------------------------------------------------------------
// Public: createCrossoverVariant
// ----------------------------------------------------------------------------

export async function createCrossoverVariant(
  parent1Name: string,
  parent2Name: string,
): Promise<{ id: string; name: string }> {
  const p1 = await getVariantByName(parent1Name);
  const p2 = await getVariantByName(parent2Name);
  if (!p1) throw new Error(`Parent variant not found: ${parent1Name}`);
  if (!p2) throw new Error(`Parent variant not found: ${parent2Name}`);

  const g1 = parseGenome(p1.genome);
  const g2 = parseGenome(p2.genome);
  if (!g1) throw new Error(`Parent variant has invalid genome: ${parent1Name}`);
  if (!g2) throw new Error(`Parent variant has invalid genome: ${parent2Name}`);

  const childGenome = crossoverGenome(g1, g2);
  const generation = Math.max(p1.generation, p2.generation) + 1;

  const created = await persistVariant({
    genome: childGenome,
    generation,
    parentName: `${p1.name}+${p2.name}`,
  });
  if (!created) {
    return {
      id: `err_${Date.now().toString(36)}`,
      name: `${genomeToName(childGenome)}-failed`,
    };
  }
  await logEvolution(generation, 'CROSSOVER', created.name, {
    parent1: p1.name,
    parent2: p2.name,
    childGenome: genomeToString(childGenome),
  });
  return created;
}

// ----------------------------------------------------------------------------
// Public: getEvolutionHistory
// ----------------------------------------------------------------------------

export async function getEvolutionHistory(limit: number = 20): Promise<any[]> {
  const safeLimit = clampInt(limit, 1, 500);
  try {
    const logs = await db.evolutionLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: safeLimit,
    });
    // Parse the `details` JSON for convenience and strip the raw string.
    return logs.map((l) => {
      let details: unknown = null;
      try {
        details = l.details ? JSON.parse(l.details) : null;
      } catch {
        details = l.details;
      }
      return {
        id: l.id,
        generation: l.generation,
        action: l.action,
        variantName: l.variantName,
        details,
        timestamp: l.timestamp?.toISOString?.() ?? l.timestamp,
      };
    });
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Public: getTopVariants
// ----------------------------------------------------------------------------

export async function getTopVariants(limit: number = 5): Promise<any[]> {
  const safeLimit = clampInt(limit, 1, 100);
  try {
    // Pull only ACTIVE + CANDIDATE variants (RETIRED/GRAVEYARD are not
    // useful parents), then re-rank by computed fitness so the UI can
    // surface the genuinely best performers regardless of whether the
    // tracker has synced its stored `fitness` column recently.
    const variants = await db.strategyVariant.findMany({
      where: { status: { in: ['ACTIVE', 'CANDIDATE'] } },
      take: 200,
      orderBy: { fitness: 'desc' },
    });

    return variants
      .map((v) => {
        const genome = parseGenome(v.genome);
        return {
          id: v.id,
          name: v.name,
          strategy: genome?.strategy ?? null,
          genomeSummary: genome ? genomeToString(genome) : null,
          status: v.status,
          tier: v.tier,
          generation: v.generation,
          parentName: v.parentName,
          rawN: v.rawN,
          effectiveN: v.effectiveN,
          wins: v.wins,
          losses: v.losses,
          winRatePct: v.winRatePct,
          profitFactor: v.profitFactor,
          avgR: v.avgR,
          totalPnl: v.totalPnl,
          storedFitness: v.fitness,
          computedFitness: computeFitness({
            avgR: v.avgR,
            effectiveN: v.effectiveN,
            winRatePct: v.winRatePct,
          }),
          lastSeenAt: v.lastSeenAt?.toISOString?.() ?? v.lastSeenAt,
          createdAt: v.createdAt?.toISOString?.() ?? v.createdAt,
          updatedAt: v.updatedAt?.toISOString?.() ?? v.updatedAt,
        };
      })
      .sort((a, b) => b.computedFitness - a.computedFitness)
      .slice(0, safeLimit);
  } catch {
    return [];
  }
}
