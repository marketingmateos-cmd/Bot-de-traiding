import Anthropic from "@anthropic-ai/sdk";
import type {
  AIAnalystInput,
  AIAnalystOutput,
  AICriticInput,
  AICriticOutput,
  AIProvider,
} from "../types";
import { DemoAIProvider } from "./demo-provider";

const ANALYST_SYSTEM = `You are the ANALYST layer of a crypto paper-trading research lab.
You NEVER place real orders and you know all trading here is simulated.
You must respond with ONLY a single JSON object matching exactly this TypeScript type,
no prose before or after:

{
  "signal": "LONG" | "SHORT" | "FLAT",
  "confidence": number,           // 0..1
  "reasons": string[],
  "risks": string[],
  "invalidation_conditions": string[],
  "data_quality": number,         // 0..100
  "recommendation": "APPROVE" | "LOW_CONFIDENCE" | "REJECT"
}

Be skeptical. A short winning streak is not proof of edge. If evidence is weak, say so
and prefer LOW_CONFIDENCE or REJECT over APPROVE.`;

const CRITIC_SYSTEM = `You are the CRITIC / DEVIL'S ADVOCATE layer of a crypto paper-trading research lab.
Your job is to try to falsify the ANALYST's hypothesis: look for bias, insufficient data,
contradictions, overfitting, weak signals, incompatible regime, and excessive risk.
Respond with ONLY a single JSON object matching exactly this TypeScript type, no prose:

{
  "verdict": "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED",
  "challengedReasons": string[],
  "biasesFound": string[],
  "overfittingConcern": boolean,
  "notes": string
}`;

function safeParseJson<T>(text: string): T | null {
  try {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * Real Claude-backed analyst/critic. Falls back to the deterministic demo
 * provider on any failure (network, parse, missing key) so a flaky API
 * never breaks the Trade Gate — it just downgrades to rule-based output and
 * that downgrade is reported to the caller via `model`.
 */
export class AnthropicAIProvider implements AIProvider {
  readonly id = "anthropic";
  readonly isDemo = false;
  private client: Anthropic;
  private model: string;
  private fallback = new DemoAIProvider();

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async analyze(input: AIAnalystInput) {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: ANALYST_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(input) }],
      });
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const parsed = safeParseJson<AIAnalystOutput>(text);
      if (!parsed) throw new Error("Analyst output did not parse as JSON");
      return {
        output: parsed,
        tokensIn: message.usage?.input_tokens ?? 0,
        tokensOut: message.usage?.output_tokens ?? 0,
        model: this.model,
      };
    } catch {
      const fallback = await this.fallback.analyze(input);
      return { ...fallback, model: `${this.fallback.id} (anthropic-fallback)` };
    }
  }

  async critique(input: AICriticInput) {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: CRITIC_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(input) }],
      });
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const parsed = safeParseJson<AICriticOutput>(text);
      if (!parsed) throw new Error("Critic output did not parse as JSON");
      return {
        output: parsed,
        tokensIn: message.usage?.input_tokens ?? 0,
        tokensOut: message.usage?.output_tokens ?? 0,
        model: this.model,
      };
    } catch {
      const fallback = await this.fallback.critique(input);
      return { ...fallback, model: `${this.fallback.id} (anthropic-fallback)` };
    }
  }
}
