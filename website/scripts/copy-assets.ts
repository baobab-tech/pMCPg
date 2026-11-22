// Copies the README diagrams (docs/assets) into public/help, where the shared help articles expect them.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..", "..", "docs", "assets");
const out = join(import.meta.dirname, "..", "public", "help");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter((f) => f.endsWith(".svg"))) cpSync(join(src, f), join(out, f));
cpSync(join(src, "logo.svg"), join(import.meta.dirname, "..", "app", "icon.svg"));
