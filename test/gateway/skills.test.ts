// Skills through the running gateway: library on disk, a stdio server's skills, profiles, UI API.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchCode, SESSION_COOKIE } from "../../src/api/auth.ts";
import { type Gateway, startGateway } from "../../src/gateway/runtime.ts";
import { skillMd } from "../fixtures/skills.ts";

const server = join(import.meta.dir, "..", "fixtures", "skills-stdio-server.ts");
let home: string;
let gw: Gateway;
let cookie = "";
let csrf = "";

async function ui(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { host: "127.0.0.1:7431" };
  if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
  if (method !== "GET") {
    headers.origin = "http://127.0.0.1:7431";
    headers["content-type"] = "application/json";
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const res = await gw.app.request(`http://127.0.0.1:7431${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const m = res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  if (m) cookie = m[1] as string;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (typeof json?.csrf === "string") csrf = json.csrf;
  return { status: res.status, json };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-skills-gw-"));
  writeFileSync(
    join(home, "config.yaml"),
    `servers:
  ops: { transport: stdio, command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(server)}] }
accounts:
  ops: { server: ops, skills: text }
profiles:
  work: { accounts: [ops] }
`,
  );
  gw = await startGateway({ home, listen: false, openBrowser: async () => {}, uiAssets: {} });
  await gw.catalog.refreshMissing();
  await gw.handle.skills?.sync("ops");
  const launch = await gw.app.request(`http://127.0.0.1:7431/launch?k=${createLaunchCode(gw.db)}`, {
    headers: { host: "127.0.0.1:7431" },
  });
  cookie = launch.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
  await ui("GET", "/api/ui/session");
});

afterAll(async () => {
  await gw?.close();
});

describe("skills in the gateway", () => {
  test("a server's skills are pinned on first sync, text only", () => {
    const s = gw.handle.skills?.server("ops") ?? [];
    expect(s.map((x) => [x.id, x.status, x.served])).toEqual([["ops/deploy", "active", true]]);
    expect(s[0]?.files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });

  test("UI: create a library skill, add it to a profile, read it, delete it", async () => {
    const created = await ui("POST", "/api/ui/skills/library", {
      name: "notes",
      files: [
        { path: "SKILL.md", text: skillMd("notes", "Meeting notes") },
        { path: "logo.bin", base64: Buffer.from([0, 1, 2]).toString("base64") },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.json.profiles).toEqual(["all"]);
    expect(existsSync(join(home, "skills", "notes", "SKILL.md"))).toBe(true);

    expect(
      (
        await ui("POST", "/api/ui/skills/library", {
          name: "notes",
          files: [{ path: "SKILL.md", text: "x" }],
        })
      ).status,
    ).toBe(409);
    const bad = await ui("POST", "/api/ui/skills/library", {
      name: "oops",
      files: [{ path: "SKILL.md", text: "x" }],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("---");

    const patched = await ui("PATCH", "/api/ui/profiles/work", { skills: ["notes"] });
    expect(patched.status).toBe(200);
    expect(patched.json.skills).toEqual(["notes"]);
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toContain("skills:");
    expect((await ui("PATCH", "/api/ui/profiles/work", { skills: ["nope"] })).status).toBe(404);
    expect((await ui("PATCH", "/api/ui/profiles/all", { skills: ["notes"] })).status).toBe(400);

    const read = await ui("GET", "/api/ui/skills/library/notes");
    expect(
      read.json.files.map((f: { path: string; text?: string; base64?: string }) => [
        f.path,
        f.text !== undefined,
      ]),
    ).toEqual([
      ["SKILL.md", true],
      ["logo.bin", false],
    ]);

    const list = await ui("GET", "/api/ui/skills");
    expect(list.json.library.map((k: { name: string }) => k.name)).toEqual(["notes"]);
    expect(list.json.server.map((k: { id: string }) => k.id)).toEqual(["ops/deploy"]);

    expect((await ui("DELETE", "/api/ui/skills/library/notes", {})).status).toBe(200);
    expect(existsSync(join(home, "skills", "notes"))).toBe(false);
    expect(gw.config().profiles.work?.skills ?? []).toEqual([]);
  });

  test("UI: switching an account to all files fetches its scripts; off forgets them", async () => {
    const r = await ui("PATCH", "/api/ui/accounts/ops", { skills: "all" });
    expect(r.json.skills).toBe("all");
    await gw.handle.skills?.sync("ops");
    expect(gw.handle.skills?.server("ops")[0]?.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "scripts/deploy.sh",
    ]);
    await ui("PATCH", "/api/ui/accounts/ops", { skills: "off" });
    expect(gw.handle.skills?.server("ops")).toEqual([]);
    const n = gw.db.query("SELECT COUNT(*) AS n FROM skill_pins WHERE account_id = 'ops'").get() as {
      n: number;
    };
    expect(n.n).toBe(0);
  });

  test("UI: status counts skill reviews", async () => {
    const r = await ui("GET", "/api/ui/status");
    expect(r.json.features.skills).toBe(true);
    expect(r.json.skillReviews).toBe(0);
  });
});
