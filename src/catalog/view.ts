// Placeholder view until the fetch and cache land: an empty bundled snapshot.
import type { CatalogView } from "./schema.ts";

export function emptyCatalogView(): CatalogView {
  return { entries: [], presets: [], serial: 0, fetchedAt: null, source: "snapshot" };
}
