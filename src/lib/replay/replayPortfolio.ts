import type { ReplayTradeRecord } from "./types";

/**
 * Fase 7 — ReplayPortfolio. REGLA ABSOLUTA #7: "El motor de Historical
 * Replay debe estar separado del estado de Paper Trading en vivo. Nunca
 * debe modificar posiciones, balance, journal ni estado real del paper
 * account." This class is the entire enforcement mechanism: it is a plain
 * in-memory object with no import of `@/lib/db`, no Prisma client, and no
 * reference to PaperAccount/PaperPosition/Trade/BotConfig anywhere in this
 * file. A replay run's only interaction with the real database (in
 * historicalReplayEngine.ts) is READING historical AIAnalysis rows for
 * FULL_HISTORICAL mode and, at the very end, WRITING its own dedicated
 * ReplayRun/ReplayResult rows — never anything under the live paper
 * trading schema.
 */
export interface ReplayOpenPosition {
  asset: string;
  strategyId: string;
  strategyName: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopPct: number | null;
  entryTime: string;
  highestSinceEntry: number;
  lowestSinceEntry: number;
  mae: number;
  mfe: number;
  decisionIndex: number;
}

export class ReplayPortfolio {
  readonly initialCapital: number;
  cashBalance: number;
  private readonly open = new Map<string, ReplayOpenPosition>();
  readonly closedTrades: ReplayTradeRecord[] = [];
  readonly equityCurve: { t: number; equity: number }[] = [];
  private barsWithPositionOpen = 0;
  private totalBars = 0;
  // Fase 11 — dollar-notional exposure (openNotional / equity), tracked as a
  // running max/sum rather than a full per-tick curve (O(1) per tick, no
  // extra memory for a 6-month H1 run). Distinct from `exposurePct()` above,
  // which measures TIME in market, not how much of equity is deployed.
  private maxNotionalExposurePctValue = 0;
  private notionalExposurePctSum = 0;

  constructor(initialCapital: number) {
    this.initialCapital = initialCapital;
    this.cashBalance = initialCapital;
  }

  private key(asset: string, strategyId: string): string {
    return `${asset}::${strategyId}`;
  }

  hasOpenPosition(asset: string, strategyId: string): boolean {
    return this.open.has(this.key(asset, strategyId));
  }

  getOpenPosition(asset: string, strategyId: string): ReplayOpenPosition | undefined {
    return this.open.get(this.key(asset, strategyId));
  }

  allOpenPositions(): ReplayOpenPosition[] {
    return Array.from(this.open.values());
  }

  openNotional(): number {
    return this.allOpenPositions().reduce((s, p) => s + p.entryPrice * p.quantity, 0);
  }

  assetNotional(asset: string): number {
    return this.allOpenPositions()
      .filter((p) => p.asset === asset)
      .reduce((s, p) => s + p.entryPrice * p.quantity, 0);
  }

  openPosition(position: ReplayOpenPosition, entryFee: number): void {
    this.open.set(this.key(position.asset, position.strategyId), position);
    this.cashBalance -= entryFee;
  }

  closePosition(asset: string, strategyId: string, trade: ReplayTradeRecord): void {
    this.open.delete(this.key(asset, strategyId));
    this.cashBalance += trade.netPnl;
    this.closedTrades.push(trade);
  }

  /** Records one equity-curve point for this tick; `markPrices` maps asset symbol -> current close. */
  recordTick(tMs: number, markPrices: Map<string, number>): void {
    this.totalBars++;
    let unrealized = 0;
    for (const p of this.allOpenPositions()) {
      const price = markPrices.get(p.asset) ?? p.entryPrice;
      const sign = p.direction === "LONG" ? 1 : -1;
      unrealized += sign * (price - p.entryPrice) * p.quantity;
    }
    if (this.open.size > 0) this.barsWithPositionOpen++;
    const equity = this.cashBalance + unrealized;
    this.equityCurve.push({ t: tMs, equity });

    const notionalExposurePct = equity > 0 ? (this.openNotional() / equity) * 100 : 0;
    this.maxNotionalExposurePctValue = Math.max(this.maxNotionalExposurePctValue, notionalExposurePct);
    this.notionalExposurePctSum += notionalExposurePct;
  }

  exposurePct(): number {
    return this.totalBars > 0 ? (this.barsWithPositionOpen / this.totalBars) * 100 : 0;
  }

  /** Fase 11 — the largest fraction of equity ever deployed in open positions at once, across the whole run. */
  maxNotionalExposurePct(): number {
    return this.maxNotionalExposurePctValue;
  }

  /** Fase 11 — the average fraction of equity deployed in open positions, across every recorded tick (including ticks with nothing open, which count as 0%). */
  avgNotionalExposurePct(): number {
    return this.totalBars > 0 ? this.notionalExposurePctSum / this.totalBars : 0;
  }
}
