import { anyBreakerTripped } from "@/lib/engines/circuitBreakers";
import type { Mt5AccountInfo } from "./types";

/**
 * MT5 Fase 1, spec section 3 — the ONE function that decides demo-vs-live.
 * Pure and total: never throws, never returns a third answer. Deliberately
 * defensive about the "unrecognized" case — an account type MT5 didn't
 * report, or reported as anything other than the literal string "DEMO", is
 * treated as NOT verified rather than assumed safe. There is no
 * `allowLiveTrading` parameter anywhere in this module, and there never
 * will be in this codebase — the message below is the only outcome for a
 * live account, not a default that something else can override.
 */
export const LIVE_ACCOUNT_BLOCKED_MESSAGE = "Live accounts are disabled. EdgeLab AI only supports MT5 demo accounts.";

export function verifyAccountIsDemo(accountInfo: Mt5AccountInfo | null): boolean {
  if (accountInfo === null) return false;
  return accountInfo.accountType === "DEMO";
}

export interface Mt5ExecutionEligibilityInput {
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "ERROR";
  /** Must come from a call to verifyAccountIsDemo() against the CURRENT connection — never a cached/remembered value from a previous session. */
  verifiedDemo: boolean;
}

export interface Mt5ExecutionEligibilityResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * Spec section 16's Safety Switch preconditions — today this checks every
 * precondition that has a real, existing mechanism behind it:
 * MT5 connected, account verified DEMO this session, and no circuit
 * breaker tripped. Two of the spec's listed preconditions —
 * "evaluation profile seleccionado" and a standalone "risk engine OK" —
 * have no corresponding concept in this codebase yet (see the Fase 1
 * inspection report: there is no Evaluation framework at all today) and
 * are deliberately NOT faked here with an always-true check; they are
 * Phase 2 additions once the Evaluation Risk Engine exists. Per-order risk
 * approval (Risk Engine + Trade Gate) is still enforced separately and
 * unconditionally at order-placement time (see mt5DemoExecutionAdapter.ts),
 * independent of this switch.
 */
export async function canEnableMt5Execution(input: Mt5ExecutionEligibilityInput): Promise<Mt5ExecutionEligibilityResult> {
  const reasons: string[] = [];

  if (input.connectionStatus !== "CONNECTED") {
    reasons.push("MT5 no está conectado.");
  }
  if (!input.verifiedDemo) {
    reasons.push(LIVE_ACCOUNT_BLOCKED_MESSAGE);
  }
  const breakers = await anyBreakerTripped();
  if (breakers.tripped) {
    reasons.push(`Circuit breaker(s) activo(s): ${breakers.reasons.join(", ")}`);
  }

  return { allowed: reasons.length === 0, reasons };
}
