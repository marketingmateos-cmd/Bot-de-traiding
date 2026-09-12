/**
 * SQLite (unlike Postgres) has no native Json column type in this Prisma
 * version, so every "Json" field in schema.prisma is stored as a plain
 * String column. These two helpers are the single place that (de)serializes
 * at the boundary, so the rest of the app can keep working with real
 * objects/arrays instead of raw strings.
 */

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
