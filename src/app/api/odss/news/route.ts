import { NextRequest, NextResponse } from 'next/server';
import { fetchRealNews, fetchBreakingNews, fetchNewsForBrief } from '@/lib/odss/news/news-fetcher';
import { archiveNews } from '@/lib/odss/news/archive';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = (url.searchParams.get('type') ?? 'all').toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 100);
  try {
    let news;
    switch (type) {
      case 'breaking': news = await fetchBreakingNews(limit); break;
      case 'pre': case 'intraday': case 'post': news = await fetchNewsForBrief(type as any, limit); break;
      default: news = await fetchRealNews(limit); break;
    }
    // Archive the news for entity extraction + cross-linking
    try { archiveNews(news); } catch {}
    return NextResponse.json({ news, count: news.length, type, timestamp: Date.now(), sources: ['Economic Times','Moneycontrol','Business Standard','LiveMint'] });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch news', message: (e as Error).message }, { status: 500 });
  }
}
