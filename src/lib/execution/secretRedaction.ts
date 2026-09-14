/**
 * MT5 Fase 1, spec section 22 — the credential-safety net. Everything that
 * ever touches an MT5 password (mt5DemoExecutionAdapter.ts's `connect`) is
 * required to route any resulting message through `redactSecret` before it
 * can reach a log line, an `Error`, a persisted `MT5DemoConnection` row, or
 * an API response — a defense-in-depth backstop, not the only safeguard
 * (the primary one is simpler: nothing in this module ever assigns the
 * password to a field that gets logged or persisted in the first place).
 */

/** Replaces every occurrence of `secret` inside `text` with a fixed placeholder — never a partial mask that could leak length/prefix information. */
export function redactSecret(text: string, secret: string): string {
  if (secret === "") return text;
  return text.split(secret).join("[REDACTED]");
}

/** Applies redactSecret for every secret in the list — used when a message might reference more than one sensitive value (e.g. password across a retry). */
export function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((acc, s) => redactSecret(acc, s), text);
}

/**
 * Masks a non-secret but still sensitive identifier (e.g. an MT5 login
 * number) for display — keeps only the last `visibleChars` characters, per
 * spec section 4's "Login: ••••••" mock. This is NOT for the password
 * (which is never displayed at all, masked or otherwise) — only for
 * identifiers that are safe to store but not to show in full.
 */
export function maskIdentifier(value: string | null | undefined, visibleChars = 2): string {
  if (!value) return "—";
  if (value.length <= visibleChars) return "•".repeat(value.length);
  return "•".repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
