/**
 * ODSS - Configuration System (Phase 21)
 * All thresholds, weights, risk settings, scan intervals and scoring
 * parameters must be configurable without changing source code.
 */
import { db } from '@/lib/db';

export interface ODSSConfig {
  id: string;
  // Engine weights (sum to 1.0)
  weightMarket: number;
  weightSector: number;
  weightRS: number;
  weightTechnical: number;
  weightOptionChain: number;
  weightRisk: number;
  // Risk settings
  riskPerTradePct: number;
  capital: number;
  lotSize: number;
  minRR: number;
  // Confidence thresholds
  minConfidenceEnter: number;
  minConfidenceWait: number;
  // Scan
  scanIntervalMs: number;
  // VIX
  vixHigh: number;
  vixExtreme: number;
  // Trade mgmt
  trailATRMultiple: number;
  breakevenAtR: number;
  // PCR
  pcrBullish: number;
  pcrBearish: number;
  // AI
  enableAIExplanation: boolean;
}

export const DEFAULT_CONFIG: ODSSConfig = {
  id: 'default',
  weightMarket: 0.15,
  weightSector: 0.1,
  weightRS: 0.1,
  weightTechnical: 0.25,
  weightOptionChain: 0.25,
  weightRisk: 0.15,
  riskPerTradePct: 1.0,
  capital: 200000,
  lotSize: 75,
  minRR: 2.0,
  minConfidenceEnter: 65,
  minConfidenceWait: 45,
  scanIntervalMs: 5000,
  vixHigh: 18,
  vixExtreme: 25,
  trailATRMultiple: 2.0,
  breakevenAtR: 1.0,
  pcrBullish: 1.2,
  pcrBearish: 0.8,
  enableAIExplanation: true,
};

// In-memory cache for the active config so we don't hit the DB every tick
let cachedConfig: ODSSConfig | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

export async function getConfig(): Promise<ODSSConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) return cachedConfig;
  try {
    const row = await db.configuration.findUnique({ where: { id: 'default' } });
    if (row) {
      cachedConfig = row as unknown as ODSSConfig;
      cacheTime = now;
      return cachedConfig!;
    }
    // Create default
    await db.configuration.create({ data: { id: 'default', ...DEFAULT_CONFIG } });
    cachedConfig = { ...DEFAULT_CONFIG };
    cacheTime = now;
    return cachedConfig;
  } catch (e) {
    // If DB not ready, fall back to defaults
    return DEFAULT_CONFIG;
  }
}

export async function updateConfig(patch: Partial<ODSSConfig>): Promise<ODSSConfig> {
  const current = await getConfig();
  const next: ODSSConfig = { ...current, ...patch, id: 'default' };
  // Normalize weights
  const sumW =
    next.weightMarket +
    next.weightSector +
    next.weightRS +
    next.weightTechnical +
    next.weightOptionChain +
    next.weightRisk;
  if (Math.abs(sumW - 1) > 0.001 && sumW > 0) {
    next.weightMarket /= sumW;
    next.weightSector /= sumW;
    next.weightRS /= sumW;
    next.weightTechnical /= sumW;
    next.weightOptionChain /= sumW;
    next.weightRisk /= sumW;
  }
  try {
    await db.configuration.upsert({
      where: { id: 'default' },
      update: {
        weightMarket: next.weightMarket,
        weightSector: next.weightSector,
        weightRS: next.weightRS,
        weightTechnical: next.weightTechnical,
        weightOptionChain: next.weightOptionChain,
        weightRisk: next.weightRisk,
        riskPerTradePct: next.riskPerTradePct,
        capital: next.capital,
        lotSize: next.lotSize,
        minRR: next.minRR,
        minConfidenceEnter: next.minConfidenceEnter,
        minConfidenceWait: next.minConfidenceWait,
        scanIntervalMs: next.scanIntervalMs,
        vixHigh: next.vixHigh,
        vixExtreme: next.vixExtreme,
        trailATRMultiple: next.trailATRMultiple,
        breakevenAtR: next.breakevenAtR,
        pcrBullish: next.pcrBullish,
        pcrBearish: next.pcrBearish,
        enableAIExplanation: next.enableAIExplanation,
      },
      create: {
        id: 'default',
        weightMarket: next.weightMarket,
        weightSector: next.weightSector,
        weightRS: next.weightRS,
        weightTechnical: next.weightTechnical,
        weightOptionChain: next.weightOptionChain,
        weightRisk: next.weightRisk,
        riskPerTradePct: next.riskPerTradePct,
        capital: next.capital,
        lotSize: next.lotSize,
        minRR: next.minRR,
        minConfidenceEnter: next.minConfidenceEnter,
        minConfidenceWait: next.minConfidenceWait,
        scanIntervalMs: next.scanIntervalMs,
        vixHigh: next.vixHigh,
        vixExtreme: next.vixExtreme,
        trailATRMultiple: next.trailATRMultiple,
        breakevenAtR: next.breakevenAtR,
        pcrBullish: next.pcrBullish,
        pcrBearish: next.pcrBearish,
        enableAIExplanation: next.enableAIExplanation,
      },
    });
  } catch (e) {
    // ignore DB errors, keep in-memory
  }
  cachedConfig = next;
  cacheTime = Date.now();
  return next;
}

// Synchronous getter for engines that need config without await.
// Returns cached or defaults; ensure getConfig() was called recently.
export function getConfigSync(): ODSSConfig {
  return cachedConfig ?? DEFAULT_CONFIG;
}
