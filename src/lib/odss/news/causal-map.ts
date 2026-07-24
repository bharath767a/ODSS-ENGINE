/**
 * ODSS — News CAUSAL-LINKAGE Map
 * ==============================
 *
 * Retail reads "crude jumps 3%" and does nothing. A desk instantly knows:
 * upstream producers benefit, OMCs/paints/tyres bleed. This module encodes
 * those second-order relationships DETERMINISTICALLY — macro/sector headline →
 * affected symbols with a signed impact and a human-readable reason.
 *
 * Design rules (kept deliberately strict so this NEVER mis-tags like the old
 * loose sector keywords did):
 *   - Triggers are specific multi-word phrases, not fragments.
 *   - Every impact carries its reason — shown to the user, auditable.
 *   - Direction detection reads the headline's own up/down language; if the
 *     direction can't be read confidently, the link contributes NOTHING.
 *   - Impact is capped well below direct stock news — causal context supports
 *     a pick, it never manufactures one.
 */

export interface CausalImpact { boost: number; note: string; }

interface Target {
  symbols?: string[];        // specific tickers (filtered to universe at use)
  sector?: string;           // or a whole sector
  sign: 1 | -1;              // impact sign WHEN THE EVENT DIRECTION IS "UP"
  note: string;              // human reason, {dir} replaced with up/down word
}

interface CausalLink {
  id: string;
  triggers: string[];        // lowercase phrases — ANY match arms the link
  strength: number;          // base magnitude (3-7); direct news is ±20 scale
  targets: Target[];
  fixedDirection?: 1 | -1;   // event has inherent direction (e.g. "warning letter" is always bad)
}

// WORD-BOUNDARY matched — plain substring matching mis-read "rainFALL" as a
// fall and "production CUTS" as bearish. 'cut/cuts' is excluded entirely from
// generic direction words (rate-cut links carry fixedDirection instead).
const UP_WORDS = ['surge', 'surges', 'jump', 'jumps', 'rise', 'rises', 'rally', 'rallies', 'climb', 'climbs', 'gain', 'gains', 'up', 'higher', 'record high', 'above normal', 'strengthens', 'soars', 'spikes', 'beats', 'strong'];
const DOWN_WORDS = ['fall', 'falls', 'drop', 'drops', 'slide', 'slides', 'slump', 'slumps', 'crash', 'crashes', 'decline', 'declines', 'down', 'lower', 'record low', 'below normal', 'weakens', 'plunges', 'tanks', 'misses', 'weak'];
const wordRe = (w: string) => new RegExp('\\b' + w.replace(/ /g, '\\s+') + '\\b');
const UP_RES = UP_WORDS.map(wordRe);
const DOWN_RES = DOWN_WORDS.map(wordRe);

const LINKS: CausalLink[] = [
  {
    id: 'crude', strength: 6,
    triggers: ['crude oil', 'brent crude', 'crude price', 'oil price', 'opec', 'wti crude'],
    targets: [
      { symbols: ['ONGC', 'OIL'], sign: 1, note: 'crude {dir} → upstream producers' },
      { symbols: ['IOC', 'BPCL', 'HPCL'], sign: -1, note: 'crude {dir} → OMC margin pressure' },
      { symbols: ['ASIANPAINT', 'BERGEPAINT'], sign: -1, note: 'crude {dir} → paint input costs' },
      { symbols: ['INDIGO', 'INTERGLOBE'], sign: -1, note: 'crude {dir} → aviation fuel costs' },
      { symbols: ['MRF', 'APOLLOTYRE', 'CEAT'], sign: -1, note: 'crude {dir} → tyre input costs' },
    ],
  },
  {
    id: 'rupee', strength: 5,
    triggers: ['rupee', 'usd/inr', 'usdinr'],
    // NOTE: sign convention — event "UP" here means rupee STRENGTHENS.
    targets: [
      { sector: 'IT', sign: -1, note: 'rupee {dir} → IT export realisations' },
      { sector: 'PHARMA', sign: -1, note: 'rupee {dir} → pharma export realisations' },
      { symbols: ['IOC', 'BPCL', 'HPCL'], sign: 1, note: 'rupee {dir} → crude import bill' },
    ],
  },
  {
    id: 'us-tech', strength: 4,
    triggers: ['nasdaq', 'wall street', 'us tech stocks', 's&p 500', 'dow jones'],
    targets: [{ sector: 'IT', sign: 1, note: 'US market {dir} → IT sentiment' }],
  },
  {
    id: 'accenture', strength: 6,
    triggers: ['accenture'],
    targets: [{ sector: 'IT', sign: 1, note: 'Accenture read-through {dir} → Indian IT demand proxy' }],
  },
  {
    id: 'rbi-rate-cut', strength: 6, fixedDirection: 1,
    triggers: ['rbi cuts repo', 'repo rate cut', 'rate cut by rbi', 'rbi rate cut', 'rbi slashes'],
    targets: [
      { sector: 'BANKING', sign: 1, note: 'rate cut → credit growth, treasury gains' },
      { sector: 'AUTO', sign: 1, note: 'rate cut → cheaper vehicle loans' },
      { sector: 'INFRA', sign: 1, note: 'rate cut → lower funding costs' },
      { sector: 'FINANCIAL', sign: 1, note: 'rate cut → NBFC borrowing costs ease' },
    ],
  },
  {
    id: 'rbi-rate-hike', strength: 6, fixedDirection: 1,
    triggers: ['rbi hikes repo', 'repo rate hike', 'rate hike by rbi', 'rbi raises rate'],
    targets: [
      { sector: 'AUTO', sign: -1, note: 'rate hike → costlier vehicle loans' },
      { sector: 'INFRA', sign: -1, note: 'rate hike → funding costs rise' },
      { sector: 'FINANCIAL', sign: -1, note: 'rate hike → NBFC margins squeeze' },
    ],
  },
  {
    id: 'china-metals', strength: 5,
    triggers: ['china stimulus', 'steel price', 'iron ore', 'copper price', 'aluminium price', 'metal prices'],
    targets: [{ sector: 'METAL', sign: 1, note: 'metal complex {dir} → Indian metal stocks' }],
  },
  {
    id: 'monsoon', strength: 4,
    triggers: ['monsoon', 'rainfall above normal', 'imd forecast'],
    targets: [
      { sector: 'FMCG', sign: 1, note: 'monsoon {dir} → rural demand' },
      { symbols: ['UPL', 'PIIND', 'COROMANDEL'], sign: 1, note: 'monsoon {dir} → agrochem demand' },
      { symbols: ['M&M', 'ESCORTS'], sign: 1, note: 'monsoon {dir} → tractor demand' },
    ],
  },
  {
    id: 'defence-order', strength: 5, fixedDirection: 1,
    triggers: ['defence contract', 'defence order', 'ministry of defence order', 'defence acquisition'],
    targets: [{ symbols: ['HAL', 'BEL', 'BDL', 'MAZDOCK'], sign: 1, note: 'defence order flow → order books' }],
  },
  {
    id: 'auto-sales', strength: 5,
    triggers: ['auto sales', 'vehicle sales', 'passenger vehicle sales', 'two-wheeler sales'],
    targets: [{ sector: 'AUTO', sign: 1, note: 'auto sales {dir} → demand read' }],
  },
  {
    id: 'usfda-negative', strength: 5, fixedDirection: -1,
    triggers: ['warning letter', 'form 483', 'import alert', 'usfda observation'],
    targets: [{ sector: 'PHARMA', sign: 1, note: 'USFDA action → compliance overhang on pharma' }],
  },
  {
    id: 'windfall-tax', strength: 5, fixedDirection: 1,
    triggers: ['windfall tax'],
    targets: [{ symbols: ['ONGC', 'OIL', 'RELIANCE'], sign: -1, note: 'windfall tax → upstream margins hit' }],
  },
];

/** Read the event's own direction from its headline. null = can't tell → no impact. */
function readDirection(text: string): 1 | -1 | null {
  const up = UP_RES.some(re => re.test(text));
  const down = DOWN_RES.some(re => re.test(text));
  if (up && !down) return 1;
  if (down && !up) return -1;
  return null; // ambiguous or directionless headline → refuse to guess
}

/**
 * Causal impact of recent macro/sector news on ONE symbol.
 * `newsItems` = recent archived news ({ title, description? }).
 * Returns capped boost (±10) + auditable reasons. One contribution per link id.
 */
export function causalNewsImpact(
  symbol: string,
  sector: string,
  newsItems: Array<{ title: string; description?: string }>,
): { boost: number; notes: string[] } {
  let boost = 0;
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const item of newsItems) {
    const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
    for (const link of LINKS) {
      if (seen.has(link.id)) continue;
      if (!link.triggers.some(t => text.includes(t))) continue;
      const dir = link.fixedDirection ?? readDirection(text);
      if (dir === null) continue; // can't read direction → contribute nothing
      for (const tgt of link.targets) {
        const hits = tgt.symbols ? tgt.symbols.includes(symbol) : tgt.sector === sector;
        if (!hits) continue;
        const impact = dir * tgt.sign * link.strength;
        boost += impact;
        const dirWord = dir === 1 ? 'up' : 'down';
        notes.push(`↳ ${tgt.note.replace('{dir}', dirWord)} (${impact > 0 ? 'tailwind' : 'headwind'})`);
        seen.add(link.id);
        break; // one target hit per link is enough for this symbol
      }
    }
  }
  return { boost: Math.max(-10, Math.min(10, boost)), notes: notes.slice(0, 2) };
}
