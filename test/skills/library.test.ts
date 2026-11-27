import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFiles, isTextFile, validPath } from "../../src/skills/files.ts";
import { SkillLibrary } from "../../src/skills/library.ts";
import { SkillError } from "../../src/skills/skills.ts";
import { skillMd } from "../fixtures/skills.ts";

const enc = (s: string) => new TextEncoder().encode(s);
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pmcpg-skills-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("file rules", () => {
  test("paths", () => {
    expect(validPath("SKILL.md")).toBe(true);
    expect(validPath("references/a b.md")).toBe(true);
    for (const bad of ["", "/abs", "../x", "a/../b", "a//b", "a\\b", "./a", "a\u0000b"])
      expect(validPath(bad)).toBe(false);
  });
  test("text files", () => {
    expect(isTextFile("SKILL.md")).toBe(true);
    expect(isTextFile("notes.TXT")).toBe(true);
    expect(isTextFile("scripts/run.py")).toBe(false);
    expect(isTextFile("logo.png")).toBe(false);
  });
  test("a skill needs SKILL.md and no duplicate paths", () => {
    expect(checkFiles([{ path: "a.md", content: enc("") }])).toContain(
      "SKILL.md: missing; every skill needs one at its root",
    );
    const dup = [
      { path: "SKILL.md", content: enc("") },
      { path: "SKILL.md", content: enc("") },
    ];
    expect(checkFiles(dup)).toContain("SKILL.md: listed twice");
  });
});

describe("SkillLibrary", () => {
  test("save, list, reload from disk, remove", async () => {
    const lib = new SkillLibrary(join(dir, "skills"));
    await lib.save("notes", [
      { path: "SKILL.md", content: enc(skillMd("notes", "Take meeting notes")) },
      { path: "templates/minutes.md", content: enc("## Minutes\n") },
    ]);
    expect(statSync(join(dir, "skills")).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, "skills", "notes", "templates", "minutes.md"))).toBe(true);
    const again = new SkillLibrary(join(dir, "skills"));
    expect(await again.load()).toEqual([]);
    const e = again.get("notes");
    expect(e?.description).toBe("Take meeting notes");
    expect(e?.entry.uri).toBe("skill://library/notes/SKILL.md");
    expect(e?.info.map((f) => f.path)).toEqual(["SKILL.md", "templates/minutes.md"]);
    expect(again.remove("notes")).toBe(true);
    expect(existsSync(join(dir, "skills", "notes"))).toBe(false);
  });

  test("replacing a skill swaps the whole folder", async () => {
    const lib = new SkillLibrary(dir);
    await lib.save("notes", [
      { path: "SKILL.md", content: enc(skillMd("notes", "v1")) },
      { path: "old.md", content: enc("old") },
    ]);
    await lib.save("notes", [{ path: "SKILL.md", content: enc(skillMd("notes", "v2")) }]);
    expect(existsSync(join(dir, "notes", "old.md"))).toBe(false);
    expect(lib.get("notes")?.description).toBe("v2");
  });

  test("refuses bad names, mismatched frontmatter and escaping paths", async () => {
    const lib = new SkillLibrary(dir);
    const ok = enc(skillMd("notes", "d"));
    await expect(lib.save("Bad Name", [{ path: "SKILL.md", content: ok }])).rejects.toBeInstanceOf(
      SkillError,
    );
    await expect(lib.save("other", [{ path: "SKILL.md", content: ok }])).rejects.toThrow(/must match/);
    await expect(
      lib.save("notes", [
        { path: "SKILL.md", content: ok },
        { path: "../escape.md", content: enc("x") },
      ]),
    ).rejects.toThrow(/not a valid relative path/);
    await expect(
      lib.save("notes", [{ path: "SKILL.md", content: enc("no frontmatter") }]),
    ).rejects.toBeInstanceOf(SkillError);
    expect(existsSync(join(dir, "escape.md"))).toBe(false);
  });

  test("load skips symlinks, bad folders and invalid skills, and ignores dotfiles", async () => {
    mkdirSync(join(dir, "good"));
    writeFileSync(join(dir, "good", "SKILL.md"), skillMd("good", "Good"));
    writeFileSync(join(dir, "good", ".DS_Store"), "x");
    mkdirSync(join(dir, "linked"));
    writeFileSync(join(dir, "linked", "SKILL.md"), skillMd("linked", "Linked"));
    symlinkSync("/etc/hosts", join(dir, "linked", "hosts"));
    mkdirSync(join(dir, "Bad_Name"));
    mkdirSync(join(dir, "broken"));
    writeFileSync(join(dir, "broken", "SKILL.md"), "no frontmatter");
    const lib = new SkillLibrary(dir);
    const warnings = await lib.load();
    expect(lib.list().map((e) => e.name)).toEqual(["good"]);
    expect(lib.get("good")?.info.map((f) => f.path)).toEqual(["SKILL.md"]);
    expect(warnings.join("\n")).toContain("linked: hosts: symlink");
    expect(warnings.join("\n")).toContain("Bad_Name");
    expect(warnings.join("\n")).toContain("broken");
  });

  test("a missing folder is an empty library", async () => {
    const lib = new SkillLibrary(join(dir, "nope"));
    expect(await lib.load()).toEqual([]);
    expect(lib.list()).toEqual([]);
  });
});
