import type { SentimentPoint, SentimentProvider } from "../types";
import { gaussian, hashStringToSeed, mulberry32 } from "../market-data/seeded-random";

export class DemoSentimentProvider implements SentimentProvider {
  readonly id = "demo";
  readonly isDemo = true;

  async getSentimentHistory(symbol: string, points: number): Promise<SentimentPoint[]> {
    const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 6));
    const rand = mulberry32(hashStringToSeed(`sentiment:${symbol}:${daySeed}`));
    const stepMs = 15 * 60_000;
    const now = Date.now();

    let score = (rand() - 0.5) * 0.6;
    const out: SentimentPoint[] = [];
    for (let i = points - 1; i >= 0; i--) {
      score = Math.max(-1, Math.min(1, score * 0.94 + gaussian(rand) * 0.05));
      out.push({ symbol, timestamp: new Date(now - i * stepMs), score });
    }
    return out;
  }
}
