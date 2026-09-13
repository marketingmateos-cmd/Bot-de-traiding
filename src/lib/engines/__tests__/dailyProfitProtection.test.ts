import { describe, expect, it } from "vitest";
import { checkExceptionalOpportunity, evaluateProfitProtection, type ProfitProtectionConfigLike } from "../dailyProfitProtection";

const config: ProfitProtectionConfigLike = {
  isEnabled: true,
  profitProtectionTriggerPct: 3,
  hardStopLossPct: -5,
  exceptionalMinConfidence: 0.85,
  exceptionalMinEvidenceLevel: "MEDIUM",
  exceptionalSizeMultiplier: 0.5,
};

describe("evaluateProfitProtection", () => {
  it("is NORMAL when today's P&L is well within range", () => {
    const result = evaluateProfitProtection({ startOfDayEquity: 1000, currentEquity: 1010, config });
    expect(result.state).toBe("NORMAL");
    expect(result.dailyPnlPct).toBeCloseTo(1, 6);
  });

  it("enters PROFIT_PROTECTION once daily gains reach the trigger — driven by real equity numbers, not an opinion", () => {
    const result = evaluateProfitProtection({ startOfDayEquity: 1000, currentEquity: 1030, config });
    expect(result.state).toBe("PROFIT_PROTECTION");
    expect(result.dailyPnlPct).toBeCloseTo(3, 6);
    expect(result.reason).toMatch(/protección de beneficios/);
  });

  it("enters HARD_DAILY_STOP once daily losses hit the hard floor", () => {
    const result = evaluateProfitProtection({ startOfDayEquity: 1000, currentEquity: 950, config });
    expect(result.state).toBe("HARD_DAILY_STOP");
    expect(result.dailyPnlPct).toBeCloseTo(-5, 6);
    expect(result.reason).toMatch(/parada dura/);
  });

  it("uses realized+unrealized equity together (the caller is responsible for computing currentEquity that way) — reflected simply as one number here", () => {
    // This engine doesn't care WHERE currentEquity came from — it's the
    // caller's job (paperTradingEngine.ts) to include unrealized P&L on
    // open positions, so profit protection can't be dodged by leaving a
    // large winning position open and unrealized.
    const result = evaluateProfitProtection({ startOfDayEquity: 1000, currentEquity: 1035, config });
    expect(result.state).toBe("PROFIT_PROTECTION");
  });

  it("is NORMAL regardless of P&L when the feature is disabled in config", () => {
    const disabled = { ...config, isEnabled: false };
    const result = evaluateProfitProtection({ startOfDayEquity: 1000, currentEquity: 500, config: disabled });
    expect(result.state).toBe("NORMAL");
  });

  it("treats zero start-of-day equity as 0% P&L rather than dividing by zero", () => {
    const result = evaluateProfitProtection({ startOfDayEquity: 0, currentEquity: 100, config });
    expect(result.dailyPnlPct).toBe(0);
    expect(result.state).toBe("NORMAL");
  });
});

describe("checkExceptionalOpportunity — the ONLY way a new trade proceeds during PROFIT_PROTECTION", () => {
  const strongInput = {
    config,
    aiAnalystConfidence: 0.9,
    aiAnalystRecommendation: "APPROVE" as const,
    aiCriticVerdict: "APPROVED" as const,
    evidenceLevel: "HIGH" as const,
    gateVerdictWithoutProfitProtection: "APPROVED" as const,
  };

  it("is exceptional when every quantitative criterion clears its bar", () => {
    const result = checkExceptionalOpportunity(strongInput);
    expect(result.isExceptional).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("is NOT exceptional on high AI confidence alone if the rest of the gate wasn't clean — never 'the AI says it's good' by itself", () => {
    const result = checkExceptionalOpportunity({ ...strongInput, gateVerdictWithoutProfitProtection: "LOW_CONFIDENCE" });
    expect(result.isExceptional).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is NOT exceptional when AI confidence is below the configured floor, even with everything else clean", () => {
    const result = checkExceptionalOpportunity({ ...strongInput, aiAnalystConfidence: 0.7 });
    expect(result.isExceptional).toBe(false);
    expect(result.reasons.some((r) => r.includes("confianza"))).toBe(true);
  });

  it("is NOT exceptional without a genuine track record (evidenceLevel below the configured minimum) — a brand-new strategy can never claim an exception", () => {
    const result = checkExceptionalOpportunity({ ...strongInput, evidenceLevel: "LOW" });
    expect(result.isExceptional).toBe(false);
    expect(result.reasons.some((r) => r.includes("evidencia"))).toBe(true);
  });

  it("is NOT exceptional if the AI Critic raised any objection at all", () => {
    const result = checkExceptionalOpportunity({ ...strongInput, aiCriticVerdict: "LOW_CONFIDENCE" });
    expect(result.isExceptional).toBe(false);
  });

  it("is NOT exceptional if the AI Analyst itself didn't fully APPROVE", () => {
    const result = checkExceptionalOpportunity({ ...strongInput, aiAnalystRecommendation: "LOW_CONFIDENCE" });
    expect(result.isExceptional).toBe(false);
  });

  it("accumulates every failing reason, not just the first one — full audit trail for why a trade was blocked", () => {
    const result = checkExceptionalOpportunity({
      config,
      aiAnalystConfidence: 0.5,
      aiAnalystRecommendation: "LOW_CONFIDENCE",
      aiCriticVerdict: "LOW_CONFIDENCE",
      evidenceLevel: "LOW",
      gateVerdictWithoutProfitProtection: "LOW_CONFIDENCE",
    });
    expect(result.isExceptional).toBe(false);
    expect(result.reasons.length).toBe(5);
  });
});
