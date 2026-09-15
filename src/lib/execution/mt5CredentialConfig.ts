import type { Mt5Credentials } from "./types";

/**
 * MT5 Data Connector phase — reads MT5_LOGIN/MT5_PASSWORD/MT5_SERVER from
 * `process.env` (the project's existing configuration surface, same as
 * `src/lib/env.ts`) into the ALREADY-existing `Mt5Credentials` pure runtime
 * parameter type — never a new credential shape, never persisted anywhere.
 *
 * Deliberately its OWN small module rather than added to the broadly-
 * imported `env` singleton in `src/lib/env.ts`: dozens of files import
 * `env` for unrelated flags, and a secret has no business living on an
 * object that many call sites might log, spread, or serialize by habit.
 * This function is called exactly where a connection attempt happens
 * (the MT5 ingestion CLI) and the resulting value is used once, then
 * discarded — never stored on `this`, never returned from an API route.
 */
export class Mt5ConfigError extends Error {}

/**
 * Fails with a SAFE, generic message when any of the three required
 * variables is missing — deliberately never names which one, so a stack
 * trace, a log line, or an error surfaced to a UI can never leak "which
 * credential is configured" as a side channel.
 */
export function getMt5CredentialsFromEnv(): Mt5Credentials {
  const login = process.env.MT5_LOGIN;
  const password = process.env.MT5_PASSWORD;
  const server = process.env.MT5_SERVER;

  if (!login || !password || !server) {
    throw new Mt5ConfigError("MT5 configuration is incomplete");
  }

  return { login, password, server };
}
