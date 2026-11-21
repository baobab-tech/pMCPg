// Launcher icons, embedded in the binary by `bun build --compile`. Each import is a file path.
// Regenerate from icon.svg with `sh scripts/icons.sh`.
import { readFileSync } from "node:fs";
import icns from "./pmcpg.icns" with { type: "file" };
import ico from "./pmcpg.ico" with { type: "file" };
import png from "./pmcpg.png" with { type: "file" };

export const iconBytes = {
  icns: () => readFileSync(icns),
  ico: () => readFileSync(ico),
  png: () => readFileSync(png),
};
