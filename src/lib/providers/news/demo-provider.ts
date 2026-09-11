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
      "El regulador señala un marco más claro para las normas de custodia de {A}",
      "Los legisladores proponen nuevos requisitos de transparencia que afectan a los exchanges de {A}",
    ],
    sentimentRange: [-0.6, 0.2],
  },
  {
    category: "ETF",
    titles: ["Una gestora solicita un ETF spot de {A}", "El ETF de {A} registra entradas diarias récord"],
    sentimentRange: [0.2, 0.8],
  },
  {
    category: "SECURITY",
    titles: ["Un exploit drena fondos de un protocolo relacionado con {A}", "Una firma de seguridad revela una vulnerabilidad ya parcheada que afectaba al puente de {A}"],
    sentimentRange: [-0.9, -0.2],
  },
  {
    category: "ADOPTION",
    titles: ["Una empresa de pagos añade una vía de liquidación en {A}", "Una red de comercios amplía la aceptación de {A}"],
    sentimentRange: [0.1, 0.7],
  },
  {
    category: "PARTNERSHIP",
    titles: ["La fundación de {A} anuncia una alianza con un proveedor de infraestructura", "Un gran custodio añade soporte para {A}"],
    sentimentRange: [0.0, 0.5],
  },
  {
    category: "TECHNOLOGY",
    titles: ["La red de {A} completa una actualización de protocolo programada", "Los desarrolladores principales publican una actualización de la hoja de ruta de {A}"],
    sentimentRange: [-0.1, 0.5],
  },
  {
    category: "MACRO",
    titles: ["Los comentarios del banco central presionan a los activos de riesgo, incluido {A}", "Un dato macro mueve los mercados cripto, {A} reacciona"],
    sentimentRange: [-0.5, 0.3],
  },
  {
    category: "EXCHANGE",
    titles: ["Un exchange reporta un volumen elevado de retiradas de {A}", "Una plataforma de trading lista un nuevo producto derivado de {A}"],
    sentimentRange: [-0.3, 0.3],
  },
  {
    category: "MARKET",
    titles: ["La volatilidad de {A} se dispara en medio de una liquidez reducida", "Los analistas señalan el posicionamiento de {A} antes de un nivel clave"],
    sentimentRange: [-0.4, 0.4],
  },
  {
    category: "PROTOCOL",
    titles: ["Se aprueba en votación un cambio de parámetro del protocolo relacionado con {A}", "Se debate una nueva propuesta en el foro del ecosistema de {A}"],
    sentimentRange: [-0.2, 0.3],
  },
  { category: "OTHER", titles: ["Un evento comunitario destaca el crecimiento del ecosistema de {A}"], sentimentRange: [-0.1, 0.3] },
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
          title: r === 0 ? title : `${title} — resumen de cobertura`,
          source: ["Cripto Wire", "On-Chain Diario", "Ledger Times", "Señal de Mercado"][Math.floor(rand() * 4)],
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
