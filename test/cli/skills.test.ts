// Runs the real `pmcpg skills` commands against a temporary PMCPG_HOME.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/main.ts";
import { ServerSkillStore } from "../../src/skills/server-skills.ts";
import { openDb } from "../../src/store/db.ts";
import { SkillServerConnector, skillMd } from "../fixtures/skills.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

let savedHome: string | undefined;
let home: string;
let src: string;
beforeAll(() => {
  savedHome = process.env.PMCPG_HOME;
  home = mkdtempSync(join(tmpdir(), "pmcpg-skills-cli-"));
  process.env.PMCPG_HOME = home;
  writeFileSync(
    join(home, "config.yaml"),
    "servers:\n  gh: { transport: http, url: 'https://gh.example/mcp' }\naccounts:\n  gh: { server: gh }\nprofiles:\n  work: { accounts: [gh] }\n",
  );
  src = mkdtempSync(join(tmpdir(), "pmcpg-skill-src-"));
  mkdirSync(join(src, "notes", "templates"), { recursive: true });
  writeFileSync(join(src, "notes", "SKILL.md"), skillMd("notes", "Meeting notes"));
  writeFileSync(join(src, "notes", "templates", "minutes.md"), "## Minutes\n");
});
afterAll(() => {
  process.env.PMCPG_HOME = savedHome;
});

describe("pmcpg skills", () => {
  test("add, enable, list, show, disable, remove", async () => {
    const added = await cli("skills", "add", join(src, "notes"));
    expect(added.code).toBe(0);
    expect(existsSync(join(home, "skills", "notes", "templates", "minutes.md"))).toBe(true);
    expect((await cli("skills", "add", join(src, "notes"))).code).toBe(1);
    expect((await cli("skills", "add", join(src, "notes"), "--replace")).code).toBe(0);

    expect((await cli("skills", "enable", "notes", "--profile", "work")).code).toBe(0);
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toMatch(/skills:\s*\n\s*- notes/);
    expect((await cli("skills", "enable", "notes", "--profile", "all")).code).toBe(2);
    expect((await cli("skills", "enable", "nope", "--profile", "work")).code).toBe(1);

    const listed = await cli("skills", "list");
    expect(listed.out).toContain("notes  2 files  profiles: all, work");

    const shown = await cli("skills", "show", "notes");
    expect(shown.out).toContain("description: Meeting notes");
    expect(shown.out).toContain("templates/minutes.md (11 bytes)");

    expect((await cli("skills", "disable", "notes", "--profile", "work")).code).toBe(0);
    expect((await cli("skills", "remove", "notes")).code).toBe(0);
    expect(existsSync(join(home, "skills", "notes"))).toBe(false);
  });

  test("add refuses a folder with a symlink or an invalid name", async () => {
    mkdirSync(join(src, "linked"));
    writeFileSync(join(src, "linked", "SKILL.md"), skillMd("linked", "x"));
    symlinkSync("/etc/hosts", join(src, "linked", "hosts"));
    const r = await cli("skills", "add", join(src, "linked"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("symlink");
    mkdirSync(join(src, "Bad Name"));
    writeFileSync(join(src, "Bad Name", "SKILL.md"), skillMd("x", "x"));
    expect((await cli("skills", "add", join(src, "Bad Name"))).code).toBe(2);
  });

  test("server mode, review, approve", async () => {
    expect((await cli("skills", "server", "gh", "text")).code).toBe(0);
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toContain("skills: text");
    // Simulate two syncs by the gateway: first pins, second sees a new skill.
    const conn = new SkillServerConnector("gh", { "a/SKILL.md": skillMd("a", "A") });
    const db = openDb(join(home, "state.db"));
    const store = new ServerSkillStore(db);
    await store.sync("gh", conn, "text");
    conn.files["b/SKILL.md"] = skillMd("b", "B");
    await conn.reload();
    await store.sync("gh", conn, "text");
    db.close();
    await conn.close();

    const review = await cli("skills", "review");
    expect(review.out).toContain("gh/b  new skill  pending");
    expect((await cli("skills", "show", "gh/b")).out).toContain("description: B");
    expect((await cli("skills", "approve", "gh/b")).code).toBe(0);
    expect((await cli("skills", "review")).out).toBe("Nothing to review.");
    expect((await cli("skills", "approve", "gh/b")).code).toBe(1);
    expect((await cli("skills", "list")).out).toContain("gh/b  active");

    expect((await cli("skills", "server", "gh", "off")).code).toBe(0);
    expect((await cli("skills", "server", "gh", "bogus")).code).toBe(2);
  });
});
