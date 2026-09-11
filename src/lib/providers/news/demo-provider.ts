import type { NewsItem, NewsProvider } from "../types";
import { hashStringToSeed, mulberry32 } from "../market-data/seeded-random";

const CATEGORIES: NewsItem["category"][] = [
  "MACRO",
  "REGULATION",
  "EXCHANGE",
  "PROTOCOL",
  "ETF",
  "SECURITY",
  "ADOPTION",
  "PARTNERSHIP",
  "TECHNOLOGY",
  "MARKET",
  "OTHER",
];

const TEMPLATES: { category: NewsItem["category"]; titles: string[]; sentimentRange: [number, number] }[] = [
  {
    category: "REGULATION",
    titles: [
      "Regulator signals clearer framework for {A} custody rules",
      "Lawmakers propose new disclosure requirements affecting {A} exchanges",
    ],
    sentimentRange: [-0.6, 0.2],
  },
  {
    category: "ETF",
    titles: ["Asset manager files for spot {A} ETF", "{A} ETF sees record daily inflows"],
    sentimentRange: [0.2, 0.8],
  },
  {
    category: "SECURITY",
    titles: ["Exploit drains funds from {A}-adjacent protocol", "Security firm discloses patched vulnerability affecting {A} bridge"],
    sentimentRange: [-0.9, -0.2],
  },
  {
    category: "ADOPTION",
    titles: ["Payments company adds {A} settlement rail", "Merchant network expands {A} acceptance"],
    sentimentRange: [0.1, 0.7],
  },
  {
    category: "PARTNERSHIP",
    titles: ["{A} foundation announces partnership with infrastructure provider", "Major custodian adds {A} support"],
    sentimentRange: [0.0, 0.5],
  },
  {
    category: "TECHNOLOGY",
    titles: ["{A} network completes scheduled protocol upgrade", "Core developers publish {A} roadmap update"],
    sentimentRange: [-0.1, 0.5],
  },
  {
    category: "MACRO",
    titles: ["Central bank commentary weighs on risk assets including {A}", "Macro data release moves crypto markets, {A} reacts"],
    sentimentRange: [-0.5, 0.3],
  },
  {
    category: "EXCHANGE",
    titles: ["Exchange reports elevated {A} withdrawal volume", "Trading venue lists new {A} derivatives product"],
    sentimentRange: [-0.3, 0.3],
  },
  {
    category: "MARKET",
    titles: ["{A} volatility spikes amid thin liquidity", "Analysts flag {A} positioning ahead of key level"],
    sentimentRange: [-0.4, 0.4],
  },
  {
    category: "PROTOCOL",
    titles: ["Governance vote passes for {A}-related protocol parameter change", "New proposal debated in {A} ecosystem forum"],
    sentimentRange: [-0.2, 0.3],
  },
  { category: "OTHER", titles: ["Community event highlights {A} ecosystem growth"], sentimentRange: [-0.1, 0.3] },
];

export class DemoNewsProvider implements NewsProvider {
  readonly id = "demo";
  readonly isDemo = true;

  async getRecentNews(symbols: string[], limit: number): Promise<NewsItem[]> {
    const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 3));
    const rand = mulberry32(hashStringToSeed(`news:${symbols.join(",")}:${daySeed}`));
    const items: NewsItem[] = [];
    const now = Date.now();

    // A handful of "clusters" simulate the same story being covered by
    // multiple outlets, so novelty scoring has something real to dedup.
    const clusterCount = Math.max(3, Math.floor(limit / 4));

    for (let c = 0; c < clusterCount; c++) {
      const template = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
      const symbol = symbols[Math.floor(rand() * symbols.length)] ?? "BTC";
      const titleTpl = template.titles[Math.floor(rand() * template.titles.length)];
      const title = titleTpl.replace("{A}", symbol);
      const [lo, hi] = template.sentimentRange;
      const sentiment = lo + rand() * (hi - lo);
      const importance = Math.round(40 + rand() * 60);
      const publishTime = now - Math.floor(rand() * 1000 * 60 * 60 * 48);
      const clusterKey = `${template.category}:${symbol}:${titleTpl}`;
      const repeats = 1 + Math.floor(rand() * 3);

      for (let r = 0; r < repeats && items.length < limit; r++) {
        items.push({
          title: r === 0 ? title : `${title} — coverage roundup`,
          source: ["CoinDesk-like Wire", "OnChain Daily", "Ledger Times", "Market Signal"][Math.floor(rand() * 4)],
          publishedAt: new Date(publishTime + r * 1000 * 60 * 15),
          category: template.category,
          importance,
          sentiment,
          intensity: Math.round(Math.abs(sentiment) * 100),
          entities: [symbol],
          assets: [symbol],
          clusterKey,
        });
      }
    }

    return items
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, limit);
  }
}

export { CATEGORIES };
