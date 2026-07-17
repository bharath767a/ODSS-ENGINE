export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export interface NewsItem {
  id: string; title: string; source: string; sentiment: Sentiment;
  link?: string; timestamp: number; category?: string; description?: string;
}
