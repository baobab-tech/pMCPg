import type { Database } from "bun:sqlite";

/** Keys of `table` that start with `stored + prefix`, returned without `stored`. Filtered in JS to avoid LIKE escaping. */
export function listByPrefix(
  db: Database,
  table: "settings" | "secrets",
  stored: string,
  prefix: string,
): string[] {
  const full = stored + prefix;
  return db
    .query<{ key: string }, []>(`SELECT key FROM ${table} ORDER BY key`)
    .all()
    .filter((r) => r.key.startsWith(full))
    .map((r) => r.key.slice(stored.length));
}
