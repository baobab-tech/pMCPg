// Reads public/catalog/v1/catalog.json at build time. Server components only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_PATH, type Catalog } from "@/lib/catalog";

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(join(process.cwd(), "public", CATALOG_PATH), "utf8")) as Catalog;
}
