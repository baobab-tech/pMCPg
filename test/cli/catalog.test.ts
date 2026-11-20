import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_ENABLED, CATALOG_SOON, catalogSearch } from "../../src/cli/commands-catalog.ts";
import { run } from "../../src/cli/main.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("catalog gate", () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  afterEach(() => fetchSpy.mockClear());

  test("is off in this release", () => {
    expect(CATALOG_ENABLED).toBe(false);
  });

  test("catalog search says coming soon, exits 2 and makes no request", async () => {
    const r = await cli("catalog", "search", "grants", "funding");
    expect(r.code).toBe(2);
    expect(r.err).toBe(CATALOG_SOON);
    expect(r.err).toContain("coming soon");
    expect(r.err).toContain("pmcpg import");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("help marks the command as coming soon", async () => {
    const r = await cli("catalog", "--help");
    expect(r.out).toContain("(coming soon)");
  });

  test("the enabled branch is a stub, not a request", () => {
    const err: string[] = [];
    const code = catalogSearch(
      { positionals: ["x"], values: {} },
      { out: () => {}, err: (l) => err.push(l) },
      true,
    );
    expect(code).toBe(2);
    expect(err.join()).toContain("not wired yet");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("no source file holds a catalog or registry URL", () => {
    const src = join(import.meta.dir, "..", "..", "src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const hits = files.filter((f) =>
      /https?:\/\/[^\s"'`]*(catalog|registry\.modelcontextprotocol)/i.test(
        readFileSync(join(src, f), "utf8"),
      ),
    );
    expect(hits).toEqual([]);
  });
});
