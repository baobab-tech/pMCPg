// Help content and the help page's pure logic. The Next.js build (ui/lib/help.ts) checks the same
// rules; these run in `bun test`, before the UI's own dependencies are installed.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../../ui/components/help/diagnose.ts";
import type { Account, AccountState } from "../../ui/lib/api.ts";
import { HELP_GROUPS, type HelpSummary, searchHelp } from "../../ui/lib/help-groups.ts";

const DIR = join(import.meta.dir, "..", "..", "help");
const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const slugs = new Set(files.map((f) => f.replace(/\.md$/, "")));

function parse(file: string) {
  const src = readFileSync(join(DIR, file), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  const meta = Object.fromEntries(
    (m?.[1] ?? "")
      .split("\n")
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  return { meta, body: src.slice(m?.[0].length ?? 0) };
}

describe("help articles", () => {
  test("15 or more, every group used", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    const groups = new Set(files.map((f) => parse(f).meta.group));
    for (const g of HELP_GROUPS) expect(groups.has(g.id)).toBe(true);
  });

  for (const file of files) {
    test(file, () => {
      const { meta, body } = parse(file);
      expect(meta.title).toBeTruthy();
      expect(meta.summary).toBeTruthy();
      expect(HELP_GROUPS.map((g) => g.id as string)).toContain(meta.group ?? "");
      expect(Number(meta.order)).toBeGreaterThan(0);
      for (const [, slug] of body.matchAll(/\]\(help:([a-z0-9-]+)/g)) expect(slugs).toContain(slug ?? "");
      // Short pages: the body stays near 300 words, markers and tables included.
      expect(body.split(/\s+/).filter(Boolean).length).toBeLessThan(330);
    });
  }
});

describe("searchHelp", () => {
  const a = (slug: string, title: string, summary: string): HelpSummary => ({
    slug,
    title,
    summary,
    group: "troubleshooting",
    order: 1,
    live: false,
  });
  const list = [
    a("keys", "Where your keys are stored", "Encrypted, with a master key in the keychain."),
    a("signin", "Sign-in needed", "The service stopped accepting the saved sign-in."),
  ];

  test("every word must match; title hits first; accents and case ignored", () => {
    expect(searchHelp(list, "").length).toBe(2);
    expect(searchHelp(list, "KEYCHAIN").map((x) => x.slug)).toEqual(["keys"]);
    expect(searchHelp(list, "sign-in saved").map((x) => x.slug)).toEqual(["signin"]);
    expect(searchHelp(list, "sígn").map((x) => x.slug)).toEqual(["signin"]);
    expect(searchHelp(list, "keys nothing")).toEqual([]);
  });
});

describe("diagnose", () => {
  const account = (state: AccountState, extra: Partial<Account> = {}): Account => ({
    id: "acc",
    label: null,
    server: "srv",
    serverName: "srv",
    transport: "stdio",
    auth: "none",
    signedIn: null,
    headers: [],
    env: [],
    params: [],
    clientId: null,
    skills: "off",
    state,
    tools: 3,
    profiles: ["all"],
    ...extra,
  });

  test("browser sign-in that lapsed offers sign-in", () => {
    const d = diagnose(account({ status: "sign-in-needed", reason: "x" }, { auth: "oauth", signedIn: true }));
    expect(d.fix).toBe("signin");
  });

  test("missing key offers the keys dialog", () => {
    const d = diagnose(
      account(
        { status: "error", reason: "server exited (code 1)" },
        { env: [{ name: "API_KEY", secret: true, set: false }] },
      ),
    );
    expect(d.fix).toBe("keys");
    expect(d.title).toContain("API_KEY");
  });

  test("npx not found points to Node.js", () => {
    const d = diagnose(account({ status: "unreachable", reason: "command not found: npx" }));
    expect(d.detail).toContain("Node.js");
    expect(d.article).toBe("npx-uvx-not-found");
  });

  test("uvx not found points to uv", () => {
    expect(diagnose(account({ status: "unreachable", reason: "command not found: uvx" })).detail).toContain(
      "uv",
    );
  });

  test("idle and connected are fine", () => {
    expect(diagnose(account({ status: "stopped" })).title).toContain("nothing wrong");
    expect(diagnose(account({ status: "connected" })).title).toBe("Working");
  });

  test("articles it links to exist", () => {
    const states: AccountState[] = [
      { status: "sign-in-needed", reason: "x" },
      { status: "unreachable", reason: "timed out" },
      { status: "unreachable", reason: "fetch failed" },
      { status: "error", reason: "server exited (code 1)" },
      { status: "error", reason: "bad" },
      { status: "connected" },
    ];
    for (const s of states) {
      const article = diagnose(account(s, { tools: 0 })).article;
      if (article) expect(slugs).toContain(article);
    }
  });
});
