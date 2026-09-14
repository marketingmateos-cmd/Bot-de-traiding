import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { advanceToPhase2, createEvaluationAccount, getEvaluationAccount, syncEvaluationAccount } from "../evaluationAccountStore";

async function resetEvaluationAccount() {
  await prisma.evaluationAccount.deleteMany({ where: { id: "main" } });
  await prisma.executionEvent.deleteMany({ where: { symbol: { startsWith: "EVAL_TEST_" } } });
  await prisma.systemAlert.deleteMany({ where: { kind: { in: ["EVALUATION_FAILED", "EVALUATION_TARGET_REACHED"] } } });
}

beforeEach(resetEvaluationAccount);
afterEach(resetEvaluationAccount);

describe("MT5 Fase 2, spec section 1 — createEvaluationAccount profiles", () => {
  it("creates a 20K profile with the exact spec defaults", async () => {
    const row = await createEvaluationAccount("20K");
    expect(row.initialBalance).toBe(20000);
    expect(row.phase).toBe("PHASE_1");
    expect(row.status).toBe("ACTIVE");
    expect(row.phase1TargetPct).toBe(10);
    expect(row.phase2TargetPct).toBe(5);
    expect(row.dailySafetyPct).toBe(-3);
    expect(row.dailyHardPct).toBe(-5);
    expect(row.totalSafetyPct).toBe(-6);
    expect(row.totalHardPct).toBe(-10);
    expect(row.baseRiskPct).toBe(1);
    expect(row.minRRR).toBe(1.5);
  });

  it("creates a 50K profile", async () => {
    const row = await createEvaluationAccount("50K");
    expect(row.initialBalance).toBe(50000);
  });

  it("creates a 100K profile", async () => {
    const row = await createEvaluationAccount("100K");
    expect(row.initialBalance).toBe(100000);
  });

  it("creates a CUSTOM profile from explicit values", async () => {
    const row = await createEvaluationAccount("CUSTOM", { initialBalance: 12345, baseRiskPct: 0.75, minRRR: 2.5 });
    expect(row.profileType).toBe("CUSTOM");
    expect(row.initialBalance).toBe(12345);
    expect(row.baseRiskPct).toBe(0.75);
    expect(row.minRRR).toBe(2.5);
  });

  it("re-creating (restarting) the evaluation resets all derived fields", async () => {
    await createEvaluationAccount("20K");
    await prisma.evaluationAccount.update({ where: { id: "main" }, data: { status: "FAILED", failureReason: "test", dayStartDate: "2020-01-01", dayStartEquity: 1 } });
    const restarted = await createEvaluationAccount("20K");
    expect(restarted.status).toBe("ACTIVE");
    expect(restarted.failureReason).toBeNull();
    expect(restarted.dayStartDate).toBeNull();
    expect(restarted.dayStartEquity).toBeNull();
  });
});

describe("MT5 Fase 2, spec section 11 — syncEvaluationAccount day reset", () => {
  it("establishes dayStartEquity on the first sync of a new trading day", async () => {
    await createEvaluationAccount("20K");
    const result = await syncEvaluationAccount(20500, new Date("2026-05-01T10:00:00Z"));
    expect(result?.dailyPnlPct).toBe(0); // dayStartEquity was just set to currentEquity
    const row = await getEvaluationAccount();
    expect(row?.dayStartEquity).toBe(20500);
    expect(row?.dayStartDate).toBe("2026-05-01");
  });

  it("keeps the same dayStartEquity across multiple syncs within the same UTC day", async () => {
    await createEvaluationAccount("20K");
    await syncEvaluationAccount(20000, new Date("2026-05-01T01:00:00Z"));
    await syncEvaluationAccount(20300, new Date("2026-05-01T12:00:00Z"));
    const row = await getEvaluationAccount();
    expect(row?.dayStartEquity).toBe(20000); // unchanged from the first sync of the day
  });

  it("resets dayStartEquity once the UTC day rolls over", async () => {
    await createEvaluationAccount("20K");
    await syncEvaluationAccount(20000, new Date("2026-05-01T23:00:00Z"));
    await syncEvaluationAccount(20800, new Date("2026-05-02T00:30:00Z"));
    const row = await getEvaluationAccount();
    expect(row?.dayStartEquity).toBe(20800);
    expect(row?.dayStartDate).toBe("2026-05-02");
  });

  it("returns null when no evaluation account is configured — never fabricates one", async () => {
    const result = await syncEvaluationAccount(20000, new Date());
    expect(result).toBeNull();
  });
});

describe("MT5 Fase 2, spec section 12 — target reached persistence", () => {
  it("persists TARGET_REACHED exactly once, with targetReachedAt/daysToTarget/finalEquity/finalBalance", async () => {
    await createEvaluationAccount("20K");
    const result = await syncEvaluationAccount(22000, new Date("2026-05-05T00:00:00Z")); // +10%
    expect(result?.status).toBe("TARGET_REACHED");

    const row = await getEvaluationAccount();
    expect(row?.status).toBe("TARGET_REACHED");
    expect(row?.targetReachedAt).not.toBeNull();
    expect(row?.finalEquity).toBe(22000);
    expect(row?.finalBalance).toBe(22000);
    expect(row?.daysToTarget).toBeGreaterThanOrEqual(1);

    const alert = await prisma.systemAlert.findFirst({ where: { kind: "EVALUATION_TARGET_REACHED" } });
    expect(alert).not.toBeNull();
  });

  it("does not re-fire the alert on a second sync while already TARGET_REACHED", async () => {
    await createEvaluationAccount("20K");
    await syncEvaluationAccount(22000, new Date("2026-05-05T00:00:00Z"));
    await syncEvaluationAccount(22100, new Date("2026-05-05T01:00:00Z"));
    const alerts = await prisma.systemAlert.findMany({ where: { kind: "EVALUATION_TARGET_REACHED" } });
    expect(alerts).toHaveLength(1);
  });
});

describe("MT5 Fase 2, spec section 1 — FAILED persistence (daily and total hard stops)", () => {
  it("persists FAILED with failureReason/failedAt on a total hard stop breach", async () => {
    await createEvaluationAccount("20K");
    const result = await syncEvaluationAccount(17900, new Date("2026-05-05T00:00:00Z")); // -10.5%
    expect(result?.status).toBe("FAILED");

    const row = await getEvaluationAccount();
    expect(row?.status).toBe("FAILED");
    expect(row?.failureReason).toMatch(/TOTAL_HARD_STOP/);
    expect(row?.failedAt).not.toBeNull();
  });

  it("persists FAILED on a daily hard stop breach the same trading day", async () => {
    await createEvaluationAccount("20K");
    await syncEvaluationAccount(20000, new Date("2026-05-05T01:00:00Z")); // establishes dayStartEquity = 20000
    const result = await syncEvaluationAccount(18900, new Date("2026-05-05T05:00:00Z")); // -5.5% daily, same UTC day
    expect(result?.status).toBe("FAILED");
    expect(result?.newlyFailedReason).toMatch(/DAILY_HARD_STOP/);
  });
});

describe("MT5 Fase 2, spec section 12 — advanceToPhase2", () => {
  it("requires PHASE_1 + TARGET_REACHED, never automatic", async () => {
    await createEvaluationAccount("20K");
    await expect(advanceToPhase2()).rejects.toThrow(/PHASE_1 con status TARGET_REACHED/);
  });

  it("advances to a fresh PHASE_2 evaluation carrying finalBalance forward as the new initialBalance", async () => {
    await createEvaluationAccount("20K");
    await syncEvaluationAccount(22000, new Date("2026-05-05T00:00:00Z")); // TARGET_REACHED, finalBalance=22000
    const advanced = await advanceToPhase2();
    expect(advanced.phase).toBe("PHASE_2");
    expect(advanced.status).toBe("ACTIVE");
    expect(advanced.initialBalance).toBe(22000);
    expect(advanced.dayStartEquity).toBeNull();
    expect(advanced.targetReachedAt).toBeNull();
  });
});
