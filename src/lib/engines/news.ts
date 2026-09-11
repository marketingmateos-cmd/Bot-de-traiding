import type { NewsItem } from "@/lib/providers/types";

export interface ScoredNewsItem extends NewsItem {
  impactScore: number; // 0-100
  noveltyScore: number; // 0-100, lower for repeated coverage of the same story
}

/**
 * News Engine (spec §10). Scores importance/sentiment/recency into a single
 * Impact Score, and — critically — deduplicates near-identical coverage via
 * `clusterKey` so 20 wire reprints of one story don't count as 20 events.
 * Only the first-seen item in a cluster gets full novelty; the rest decay.
 */
export function scoreNews(items: NewsItem[]): ScoredNewsItem[] {
  const clusterFirstSeen = new Map<string, number>();
  const clusterCounts = new Map<string, number>();

  const sorted = [...items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

  return sorted.map((item) => {
    const key = item.clusterKey ?? item.title;
    const countSoFar = clusterCounts.get(key) ?? 0;
    clusterCounts.set(key, countSoFar + 1);
    if (!clusterFirstSeen.has(key)) clusterFirstSeen.set(key, item.publishedAt.getTime());

    const ageHours = (Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60);
    const recencyFactor = Math.max(0, 1 - ageHours / 48);
    const impactScore = Math.round(
      Math.max(0, Math.min(100, item.importance * 0.5 + item.intensity * 0.3 + recencyFactor * 20))
    );

    // Novelty decays sharply for repeats within the same cluster.
    const noveltyScore = Math.round(Math.max(5, 100 / Math.pow(countSoFar + 1, 1.6)));

    return { ...item, impactScore, noveltyScore };
  });
}

export interface NewsSummary {
  score: number; // 0-100, weighted by impact & novelty, used by Market Intelligence
  topStories: ScoredNewsItem[];
  clusterCount: number;
  totalArticles: number;
}

export function summarizeNews(items: NewsItem[]): NewsSummary {
  const scored = scoreNews(items);
  const clusters = new Set(scored.map((i) => i.clusterKey ?? i.title));
  const weightedSentiment =
    scored.length > 0
      ? scored.reduce((sum, i) => sum + i.sentiment * (i.impactScore / 100) * (i.noveltyScore / 100), 0) /
        Math.max(1, scored.length)
      : 0;

  // Map sentiment (-1..1) to a 0-100 "News" component score, centered at 50.
  const score = Math.round(Math.max(0, Math.min(100, 50 + weightedSentiment * 60)));

  const topStories = [...scored].sort((a, b) => b.impactScore * b.noveltyScore - a.impactScore * a.noveltyScore).slice(0, 8);

  return { score, topStories, clusterCount: clusters.size, totalArticles: items.length };
}
