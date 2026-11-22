import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DecideDeps, decideApproval } from "../../src/cli/commands-policy.ts";
import { run } from "../../src/cli/main.ts";
import { paths } from "../../src/core/paths.ts";
import { SqliteApprovalStore } from "../../src/policy/approvals.ts";
import { openDb } from "../../src/store/db.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const CONFIG = `
servers:
  gmail:
    transport: http
    url: https://gmail.example/mcp
    trust: [private-data, can-send]
  web:
    transport: http
    url: https://web.example/mcp
    trust: [external-content]
accounts:
  gmail-work:
    server: gmail
  web:
    server: web
profiles:
  briefing:
    accounts: [gmail-work, web]
    deny: ["gmail-work__delete_*"]
    policy:
      preset: balanced
      approvalTimeout: 60
      rules:
        - when: { tool: "gmail-*__send_*" }
          then: ask
          reason: Sending email always needs your OK.
        - when: { tool: "web__*" }
          then: allow
  research:
    accounts: [web]
    readOnly: true
    policy: { preset: careful }
`;

let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.PMCPG_HOME;
  process.env.PMCPG_HOME = mkdtempSync(join(tmpdir(), "pmcpg-policy-cli-"));
  const p = paths();
  writeFileSync(p.config, CONFIG);
  const db = openDb(p.db);
  const tool = (name: string, annotations: Record<string, boolean>) =>
    db.run(
      "INSERT INTO tool_cache (account_id, tool_name, definition, hash, fetched_at) VALUES (?, ?, ?, 'h', 0)",
      ["gmail-work", name, JSON.stringify({ name, inputSchema: {}, annotations })],
    );
  tool("send_email", { readOnlyHint: false, destructiveHint: false });
  tool("search", { readOnlyHint: true });
  tool("archive", { readOnlyHint: false, destructiveHint: true });
  db.close();
});

afterAll(() => {
  process.env.PMCPG_HOME = prevHome;
});

describe("pmcpg policy explain", () => {
  test("lists deny list, custom rules, preset rules and the default, in order", async () => {
    const r = await cli("policy", "explain", "briefing");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        "Profile briefing: balanced preset. Checked in order; the first match decides.",
        '  1. Block tools on the deny list: "gmail-work__delete_*".  (deny list)',
        '  2. Ask before calling tools named "gmail-*__send_*".  (your rule 1)',
        "     Reason shown: Sending email always needs your OK.",
        '  3. Allow tools named "web__*".  (your rule 2)',
        "  4. Ask before calling tools that may delete or overwrite data.  (balanced preset)",
        "  5. Ask before calling tools from servers that can send data out, once this session has read outside content (web pages, emails, documents).  (balanced preset)",
        "  6. Otherwise allow.  (default)",
        "Approval requests wait 1 minute; no answer counts as declined.",
      ].join("\n"),
    );
  });

  test("read-only profile and the implicit all profile", async () => {
    const ro = await cli("policy", "explain", "research");
    expect(ro.out).toContain("1. Block every tool that may change data.  (read-only profile)");
    expect(ro.out).toContain("(careful preset)");
    const all = await cli("policy", "explain", "all");
    expect(all.code).toBe(0);
    expect(all.out).toContain("balanced preset");
    expect(all.out).toContain("wait 2 minutes");
  });

  test("unknown profile", async () => {
    const r = await cli("policy", "explain", "nope");
    expect(r.code).toBe(1);
    expect(r.err).toContain('No profile named "nope". Profiles: all, briefing, research');
  });
});

describe("pmcpg policy test", () => {
  test("custom rule fires before the preset", async () => {
    const r = await cli("policy", "test", "briefing", "gmail-work__send_email");
    expect(r.code).toBe(0);
    expect(r.out).toContain("gmail-work__send_email in profile briefing: ASK");
    expect(r.out).toContain("Why:   Sending email always needs your OK.");
    expect(r.out).toContain("Rule:  your rule 1\n");
  });

  test("--after external-content triggers the data-flow rule", async () => {
    const before = await cli("policy", "test", "briefing", "gmail-work__search");
    expect(before.out).toContain(": ALLOW");
    const after = await cli(
      "policy",
      "test",
      "briefing",
      "gmail-work__search",
      "--after",
      "external-content",
    );
    expect(after.out).toContain(": ASK");
    expect(after.out).toContain("Rule:  balanced preset, rule 2");
    expect(after.out).toContain("Seen:  external-content");
  });

  test("destructive, deny list, read-only, not in profile, unlisted tool", async () => {
    expect((await cli("policy", "test", "briefing", "gmail-work__archive")).out).toContain(
      "may delete or overwrite data",
    );
    expect((await cli("policy", "test", "briefing", "gmail-work__delete_all")).out).toContain(": DENY");
    const ro = await cli("policy", "test", "research", "web__fetch");
    expect(ro.out).toContain(": DENY");
    expect(ro.out).toContain("not been listed yet");
    expect((await cli("policy", "test", "research", "gmail-work__search")).out).toContain(
      "not in profile research",
    );
  });

  test("bad input", async () => {
    expect((await cli("policy", "test", "briefing", "nounderscore")).code).toBe(2);
    const bad = await cli("policy", "test", "briefing", "web__x", "--after", "webpages");
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--after must be one of");
    expect((await cli("policy", "test", "briefing", "ghost__x")).err).toContain('No account named "ghost"');
  });
});

describe("pmcpg approvals", () => {
  /** A person at a terminal who confirms, and a gateway that decides in-process. */
  const person = (store: SqliteApprovalStore, answer = true): DecideDeps => ({
    interactive: true,
    confirm: () => answer,
    send: async (id, decision) => {
      try {
        store.decide(id, decision);
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
    },
  });
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
  };

  test("list, approve, deny, errors", async () => {
    expect((await cli("approvals", "list")).out).toBe("No approval requests waiting.");
    const db = openDb(paths().db);
    const store = new SqliteApprovalStore(db, { trustTable: false });
    const a = store.create({ profileId: "briefing", tool: "gmail-work__send_email", reason: "r" });
    const b = store.create({ profileId: "briefing", tool: "gmail-work__archive", reason: "r" });

    const list = await cli("approvals", "list");
    expect(list.code).toBe(0);
    expect(list.out).toContain(a.id);
    expect(list.out).toContain("gmail-work__archive");

    const t = io();
    expect(await decideApproval(a.id, "approved", t.io, person(store))).toBe(0);
    expect(t.out).toEqual([`Approved: gmail-work__send_email (${a.id}).`]);
    expect(store.get(a.id)?.status).toBe("approved");

    expect(await decideApproval(b.id, "denied", io().io, person(store))).toBe(0);
    expect(store.get(b.id)?.status).toBe("denied");

    const again = io();
    expect(await decideApproval(a.id, "denied", again.io, person(store))).toBe(1);
    expect(again.err.join("")).toContain("already approved");
    const missing = io();
    await decideApproval("ffffffffff", "approved", missing.io, person(store));
    expect(missing.err.join("")).toContain("No approval request");

    expect((await cli("approvals", "list")).out).toBe("No approval requests waiting.");
    const all = await cli("approvals", "list", "--all");
    expect(all.out.split("\n")).toHaveLength(2);
    expect(all.out).toContain("approved");
    db.close();
  });

  test("without a person at a terminal, or without a yes, nothing is approved (POL-2)", async () => {
    const db = openDb(paths().db);
    const store = new SqliteApprovalStore(db, { trustTable: false });
    const a = store.create({ profileId: "all", tool: "gmail-work__send_email", reason: "r" });
    // No person at a terminal, like an AI client's shell. Set explicitly: `bun test` in a terminal has a TTY.
    const shell = io();
    expect(await decideApproval(a.id, "approved", shell.io, { ...person(store), interactive: false })).toBe(
      1,
    );
    expect(shell.err.join("")).toContain("need a person");
    const no = io();
    expect(await decideApproval(a.id, "approved", no.io, person(store, false))).toBe(0);
    expect(no.out).toEqual(["Nothing changed."]);
    expect(store.get(a.id)?.status).toBe("pending");
    db.close();
  });

  test("a CLI approval releases a waiting gateway call", async () => {
    const db = openDb(paths().db);
    const gateway = new SqliteApprovalStore(db, { pollMs: 10, trustTable: false });
    const a = gateway.create({ profileId: "all", tool: "gmail-work__send_email", reason: "r" });
    const waiting = gateway.wait(a.id, 5_000);
    expect(await decideApproval(a.id, "approved", io().io, person(gateway))).toBe(0);
    expect(await waiting).toBe("approved");
    db.close();
  });
});

test("invalid rules give readable config errors", async () => {
  const p = paths();
  writeFileSync(
    p.config,
    "profiles:\n  x:\n    policy:\n      rules:\n        - when: { annotaton: destructive }\n          then: maybe\n",
  );
  const r = await cli("policy", "explain", "x");
  writeFileSync(p.config, CONFIG);
  expect(r.code).toBe(1);
  expect(r.err).toContain("profiles.x.policy.rules.0.when");
  expect(r.err).toContain("annotaton");
  expect(r.err).toContain("profiles.x.policy.rules.0.then: must be allow, ask or deny");
});
