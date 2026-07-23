/**
 * ODSS — OI ANALYSIS "KNOWLEDGE PACK"
 * ===================================
 * The single place to encode HOW the engine reads option-chain order flow.
 * Everything the control engine, the confidence grade and the early-flow
 * detector use is a tunable here — so the methodology can be calibrated (or
 * replaced with your own) by editing THIS FILE, without touching engine code.
 *
 * The defaults below encode standard Indian-F&O desk methodology:
 *
 *  1. OPTION WRITING is the highest-conviction signal. Institutions WRITE
 *     options (collect premium) with conviction; retail tends to BUY. So fresh
 *     writing (short buildup) is weighted highest, then short covering (a
 *     squeeze), then buying (long buildup), then plain unwinding (an exit).
 *       - Call writing  → resistance / bearish
 *       - Put  writing  → support    / bullish
 *       - Call covering → resistance breaking / bullish
 *       - Put  unwinding→ support fading      / bearish
 *
 *  2. The fight happens NEAR the money. Strikes close to spot get most of the
 *     weight (proximitySigmaStrikes). Deep-ITM OI is noise; delta only lightly
 *     tilts the weight so near-money OTM writing isn't diluted.
 *
 *  3. PCR / max-pain / IV-skew are secondary MODIFIERS, small vs raw flow.
 *
 *  4. A high-quality pick needs the ORDER FLOW on its side. The grade gates on
 *     control: you cannot be A/A+ if the chain is against you.
 *
 *  5. EARLY FLOW = fresh, aggressive, one-sided near-money positioning while the
 *     price move still has room — smart money igniting before the crowd.
 */
export const OI_PACK = {
  // ── How strongly each OI behaviour signals direction (magnitudes, 0-1) ──
  flowWeights: {
    writing: 1.0,     // SHORT_BUILDUP — fresh writing (institutional conviction)
    covering: 0.85,   // SHORT_COVERING — writers buying back (squeeze)
    buying: 0.7,      // LONG_BUILDUP — fresh buying (often retail, weaker)
    unwinding: 0.55,  // LONG_UNWINDING — buyers exiting (weak)
  },

  // ── Strike weighting ──
  proximitySigmaStrikes: 3.0,   // near-money width (in strikes). Lower = more ATM-focused.
  deltaWeight: 0.3,             // 0..1 — how much |delta| tilts the per-strike weight.

  // ── Secondary modifiers (small, so raw flow dominates) ──
  pcrBull: 1.3, pcrBear: 0.7, pcrMod: 6,
  maxPainMod: 6,
  ivSkewRichPut: 2, ivSkewRichCall: -1, ivSkewMod: 4,

  // ── Controller cutoffs (controlScore −100..+100) ──
  controlBuyers: 20, controlSellers: -20, controlBias: 15,

  // ── Early-flow ignition ──
  earlyFlowIntensity: 60,   // 0-100 near-money freshness+turnover
  earlyFlowStrength: 60,    // control strength
  earlyFlowScore: 40,       // |controlScore|

  // ── Confidence grade (how many independent signals must align) ──
  grade: {
    tech: 62,        // technicalHealth
    control: 58,     // controlFit (order flow with the side)
    room: 52,        // room-to-target
    oc: 56,          // option-chain health
    fund: 55,        // fundamental fit
    aPlusControl: 68,   // controlFit needed for A+
    aRoom: 55,          // room needed for A+
    strongControl: 65,  // controlFit that counts as "order flow strongly with you"
  },
} as const;

export type OIPack = typeof OI_PACK;
