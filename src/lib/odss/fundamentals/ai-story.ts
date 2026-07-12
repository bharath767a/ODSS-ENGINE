/**
 * ODSS - AI Stock Story Engine
 *
 * Uses the LLM to generate a plain-English investment narrative for any stock.
 * This is the "explain it like I'm 5" feature — makes fundamentals accessible.
 *
 * The AI NEVER decides. It explains the deterministic analysis in plain English.
 */
import ZAI from 'z-ai-web-dev-sdk';
import type { FundamentalData, FundamentalScore, BuySellHoldRecommendation, StockStory } from './types';

function buildContext(data: FundamentalData, score: FundamentalScore, rec: BuySellHoldRecommendation): string {
  return [
    `Company: ${data.profile.name} (${data.profile.symbol})`,
    `Sector: ${data.profile.sector} | Industry: ${data.profile.industry}`,
    `Market Cap: ₹${(data.profile.marketCap / 1000).toFixed(0)}K crores`,
    ``,
    `VALUATION:`,
    `  P/E: ${data.valuation.peRatio} (Sector: ${data.valuation.sectorPE}, Premium/Discount: ${data.valuation.premiumDiscount}%)`,
    `  Forward P/E: ${data.valuation.forwardPE}`,
    `  P/B: ${data.valuation.pbRatio} | EV/EBITDA: ${data.valuation.evEbitda}`,
    `  PEG: ${data.valuation.pegRatio} | Dividend Yield: ${data.valuation.dividendYield}%`,
    ``,
    `EARNINGS:`,
    `  EPS: ₹${data.earnings.eps} (Forward: ₹${data.earnings.forwardEPS})`,
    `  EPS Growth YoY: ${data.earnings.epsGrowthYoY}% | 3Y CAGR: ${data.earnings.epsGrowth3Y}%`,
    `  Revenue: ₹${data.earnings.revenue} crores (Growth: ${data.earnings.revenueGrowthYoY}%)`,
    `  Net Profit: ₹${data.earnings.netProfit} crores (Growth: ${data.earnings.netProfitGrowthYoY}%)`,
    `  Margins — Operating: ${data.earnings.operatingMargin}% | Net: ${data.earnings.netProfitMargin}%`,
    `  ROE: ${data.earnings.roe}% | ROCE: ${data.earnings.roce}%`,
    ``,
    `FINANCIAL HEALTH:`,
    `  Debt/Equity: ${data.health.debtToEquity}`,
    `  Current Ratio: ${data.health.currentRatio} | Interest Coverage: ${data.health.interestCoverage}x`,
    `  Total Debt: ₹${data.health.totalDebt} crores | Free Cash Flow: ₹${data.health.freeCashFlow} crores`,
    ``,
    `OWNERSHIP:`,
    `  Promoter: ${data.ownership.promoterHolding}% (change: ${data.ownership.promoterHoldingChange}%)`,
    `  FII: ${data.ownership.fiiHolding}% (change: ${data.ownership.fiiHoldingChange}%)`,
    `  DII: ${data.ownership.diiHolding}% (change: ${data.ownership.diiHoldingChange}%)`,
    ``,
    `QUARTERLY RESULTS (last 4):`,
    ...data.quarterly.map((q) => `  ${q.quarter}: Rev ₹${q.revenue}cr, Profit ₹${q.netProfit}cr, EPS ₹${q.eps}, ${q.surprise} (${q.surprisePct}%)`),
    ``,
    `OUTLOOK:`,
    `  Business Plans: ${data.outlook.businessPlans.join('; ')}`,
    `  Analyst Consensus: ${data.outlook.analystConsensus} (target ₹${data.outlook.analystTargetPrice}, ${data.outlook.analystCount} analysts)`,
    `  Capex: ${data.outlook.capexPlans}`,
    ``,
    `FUNDAMENTAL SCORE: ${score.total}/100 (${score.rating})`,
    `  Valuation: ${score.valuation} | Growth: ${score.growth} | Profitability: ${score.profitability} | Health: ${score.financialHealth} | Quality: ${score.quality}`,
    `  Strengths: ${score.strengths.join('; ')}`,
    `  Weaknesses: ${score.weaknesses.join('; ')}`,
    ``,
    `RECOMMENDATION: ${rec.action} (${rec.confidence}% confidence)`,
    `  Fair Value: ₹${rec.fairValue} | Current: ₹${rec.currentPrice} | ${rec.upsideDownside > 0 ? 'Upside' : 'Downside'}: ${rec.upsideDownside.toFixed(1)}%`,
    `  Risk: ${rec.riskLevel} | Time Horizon: ${rec.timeHorizon}`,
  ].join('\n');
}

export async function generateStockStory(
  data: FundamentalData,
  score: FundamentalScore,
  rec: BuySellHoldRecommendation
): Promise<StockStory> {
  const context = buildContext(data, score, rec);

  const systemPrompt = `You are ODSS Stock Storyteller — an AI that explains stocks in plain English for Indian investors.
You make complex financial data simple and accessible.
You NEVER give financial advice or tell people to buy/sell. You explain the FACTS in an engaging, easy-to-understand way.
Use simple analogies. Avoid jargon. If you must use a term, explain it briefly.
Be conversational but factual. Reference the actual numbers from the data.
Keep it engaging — like a knowledgeable friend explaining a stock over coffee.`;

  const userPrompt = `Here is the complete fundamental analysis of ${data.profile.name} (${data.profile.symbol}):

${context}

Write a "Stock Story" with these sections:

1. ONE-LINER: A single catchy sentence summarizing what this company does and whether it's interesting (1 line)

2. NARRATIVE: 3-4 paragraphs telling the "story" of this stock. Cover:
   - What the company does and its market position
   - How it's performing financially (use real numbers)
   - Whether it's expensive or cheap (valuation)
   - What the future looks like
   Make it read like a story, not a data dump.

3. FOR BEGINNERS: Explain this stock in the simplest possible terms, as if explaining to someone who just started investing. Use analogies.

4. KEY TAKEAWAYS: 4-5 bullet points of the most important things to know

5. SHOULD YOU INVEST: A balanced 2-3 sentence answer (NOT advice — just framing the opportunity and risk). Start with "This stock appears to be..." not "You should..."

6. GREEN FLAGS: 2-3 positive signals (bullet points)

7. RED FLAGS: 2-3 concerns or risks (bullet points)

Format:
ONE-LINER: [text]
NARRATIVE: [text]
FOR BEGINNERS: [text]
KEY TAKEAWAYS:
- [point 1]
- [point 2]
...
SHOULD YOU INVEST: [text]
GREEN FLAGS:
- [point]
RED FLAGS:
- [point]

Keep total under 600 words.`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    });

    const content = completion.choices[0]?.message?.content ?? '';
    return parseStory(content, data);
  } catch (e) {
    return fallbackStory(data, score, rec);
  }
}

function parseStory(content: string, data: FundamentalData): StockStory {
  // Parse the structured response
  const sections: Record<string, string[]> = {};
  let currentSection = '';
  for (const line of content.split('\n')) {
    const upper = line.trim().toUpperCase();
    if (['ONE-LINER:', 'NARRATIVE:', 'FOR BEGINNERS:', 'KEY TAKEAWAYS:', 'SHOULD YOU INVEST:', 'GREEN FLAGS:', 'RED FLAGS:'].some((s) => upper.startsWith(s))) {
      currentSection = upper.split(':')[0];
      sections[currentSection] = [];
      const rest = line.substring(line.indexOf(':') + 1).trim();
      if (rest) sections[currentSection].push(rest);
    } else if (currentSection && line.trim()) {
      sections[currentSection].push(line.trim());
    }
  }

  return {
    symbol: data.profile.symbol,
    name: data.profile.name,
    narrative: (sections['NARRATURE'] ?? sections['NARRATIVE'] ?? ['Story unavailable.']).join('\n'),
    oneLiner: (sections['ONE-LINER'] ?? [''])[0],
    forBeginners: (sections['FOR BEGINNERS'] ?? ['Beginner explanation unavailable.']).join('\n'),
    keyTakeaways: sections['KEY TAKEAWAYS'] ?? [],
    shouldYouInvest: (sections['SHOULD YOU INVEST'] ?? ['Analysis unavailable.']).join('\n'),
    redFlags: sections['RED FLAGS'] ?? [],
    greenFlags: sections['GREEN FLAGS'] ?? [],
    timestamp: Date.now(),
  };
}

function fallbackStory(data: FundamentalData, score: FundamentalScore, rec: BuySellHoldRecommendation): StockStory {
  return {
    symbol: data.profile.symbol,
    name: data.profile.name,
    oneLiner: `${data.profile.name} is a ${data.profile.industry} company with a fundamental score of ${score.total}/100.`,
    narrative: `${data.profile.name} (${data.profile.symbol}) operates in the ${data.profile.industry} sector. ${data.profile.description}\n\nThe company has a P/E ratio of ${data.valuation.peRatio}, trading at a ${data.valuation.premiumDiscount > 0 ? 'premium' : 'discount'} of ${Math.abs(data.valuation.premiumDiscount)}% to its sector average. Revenue is growing at ${data.earnings.revenueGrowthYoY}% with an ROE of ${data.earnings.roe}%, indicating ${score.profitability > 60 ? 'strong' : 'moderate'} capital efficiency.\n\nWith a fundamental score of ${score.total}/100, the stock is rated ${score.rating}. The estimated fair value is ₹${rec.fairValue} against the current price of ₹${rec.currentPrice.toFixed(2)}, suggesting ${rec.upsideDownside > 0 ? 'upside' : 'downside'} potential of ${Math.abs(rec.upsideDownside).toFixed(1)}%.`,
    forBeginners: `Think of ${data.profile.name} like a ${data.profile.sector === 'BANKING' ? 'bank that takes your deposits and lends them out' : 'company that makes products/services and sells them for profit'}. A P/E ratio of ${data.valuation.peRatio} means investors are willing to pay ₹${data.valuation.peRatio} for every ₹1 of annual profit. Whether that's expensive depends on how fast the company is growing — and ${data.profile.name} is growing at ${data.earnings.revenueGrowthYoY}% per year.`,
    keyTakeaways: [
      `Fundamental score: ${score.total}/100 (${score.rating})`,
      `P/E of ${data.valuation.peRatio} (${data.valuation.premiumDiscount > 0 ? 'premium' : 'discount'} to sector)`,
      `Revenue growth: ${data.earnings.revenueGrowthYoY}%, ROE: ${data.earnings.roe}%`,
      `Fair value estimate: ₹${rec.fairValue} (${rec.upsideDownside > 0 ? '+' : ''}${rec.upsideDownside.toFixed(1)}% ${rec.upsideDownside > 0 ? 'upside' : 'downside'})`,
      `Risk level: ${rec.riskLevel}`,
    ],
    shouldYouInvest: `Based on the analysis, this stock appears to be ${rec.action === 'STRONG_BUY' || rec.action === 'BUY' ? 'an interesting opportunity with solid fundamentals' : rec.action === 'HOLD' ? 'fairly valued — worth holding if you own it, but not a compelling new buy' : 'expensive or fundamentally weak — caution is warranted'}. The ${rec.riskLevel.toLowerCase()} risk level and ${rec.timeHorizon.toLowerCase()}-term horizon should align with your investment strategy.`,
    redFlags: score.weaknesses.slice(0, 3),
    greenFlags: score.strengths.slice(0, 3),
    timestamp: Date.now(),
  };
}
