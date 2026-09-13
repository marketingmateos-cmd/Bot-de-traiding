/** Thrown instead of ever silently falling back to synthetic/fabricated data (spec rule #3). */
export class ReplayDataUnavailableError extends Error {
  constructor(public readonly detail: string) {
    super(`HISTORICAL DATA UNAVAILABLE: ${detail}`);
    this.name = "ReplayDataUnavailableError";
  }
}
