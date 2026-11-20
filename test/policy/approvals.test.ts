import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileDef } from "../../src/core/config.ts";
import { GatewayError, type ToolRef } from "../../src/core/types.ts";
import type { CallContext } from "../../src/pipeline/step.ts";
import { SqliteApprovalStore } from "../../src/policy/approvals.ts";
import { dataFlowStep, policyStep } from "../../src/policy/step.ts";
import type { ApprovalRequest } from "../../src/store/approvals.ts";
import { openDb } from "../../src/store/db.ts";

const memStore = (pollMs = 10) => new SqliteApprovalStore(openDb(":memory:"), { pollMs });
const req = { profileId: "all", tool: "gmail-work__send_email", reason: "This tool can send data out." };

describe("SqliteApprovalStore", () => {
  test("create, list, get", () => {
    const s = memStore();
    const a = s.create(req);
    expect(a).toMatchObject({ ...req, status: "pending" });
    expect(a.id).toMatch(/^[0-9a-f]{10}$/);
    s.create({ ...req, tool: "b__x" });
    expect(s.list().map((r) => r.tool)).toEqual(["b__x", req.tool]);
    expect(s.list({ status: "pending", limit: 1 })).toHaveLength(1);
    expect(s.list({ status: "approved" })).toEqual([]);
    expect(s.get(a.id)?.reason).toBe(req.reason);
  });

  test("decide resolves a waiter at once and records the time", async () => {
    const s = memStore(10_000);
    const a = s.create(req);
    const waiting = s.wait(a.id, 60_000);
    s.decide(a.id, "approved");
    expect(await waiting).toBe("approved");
    expect(s.get(a.id)?.decidedAt).toBeNumber();
  });

  test("deny", async () => {
    const s = memStore();
    const a = s.create(req);
    const waiting = s.wait(a.id, 60_000);
    s.decide(a.id, "denied");
    expect(await waiting).toBe("denied");
  });

  test("no answer: expired after the timeout", async () => {
    const s = memStore();
    const a = s.create(req);
    expect(await s.wait(a.id, 30)).toBe("expired");
    expect(s.get(a.id)?.status).toBe("expired");
    expect(() => s.decide(a.id, "approved")).toThrow("already expired");
  });

  test("abort signal expires the request", async () => {
    const s = memStore();
    const a = s.create(req);
    const ac = new AbortController();
    const waiting = s.wait(a.id, 60_000, ac.signal);
    ac.abort();
    expect(await waiting).toBe("expired");
    const b = s.create(req);
    expect(await s.wait(b.id, 60_000, AbortSignal.abort())).toBe("expired");
  });

  test("decisions from another process (another connection) are picked up by polling", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "pmcpg-approvals-")), "state.db");
    const gateway = new SqliteApprovalStore(openDb(file), { pollMs: 10 });
    const cli = new SqliteApprovalStore(openDb(file));
    const seen: ApprovalRequest[] = [];
    gateway.subscribe((r) => seen.push(r));
    const a = gateway.create(req);
    const waiting = gateway.wait(a.id, 5_000);
    expect(cli.list({ status: "pending" }).map((r) => r.id)).toEqual([a.id]);
    cli.decide(a.id, "denied");
    expect(await waiting).toBe("denied");
    expect(seen.map((r) => r.status)).toEqual(["pending", "denied"]);
    expect(seen[1]?.reason).toBe(req.reason);
  });

  test("decide rejects unknown ids and second answers", () => {
    const s = memStore();
    expect(() => s.decide("nope", "approved")).toThrow("No approval request with id nope");
    const a = s.create(req);
    s.decide(a.id, "approved");
    expect(() => s.decide(a.id, "denied")).toThrow("already approved");
  });

  test("wait on a decided request returns its status", async () => {
    const s = memStore();
    const a = s.create(req);
    s.decide(a.id, "approved");
    expect(await s.wait(a.id, 10)).toBe("approved");
    await expect(s.wait("nope", 10)).rejects.toThrow("No approval request");
  });

  test("subscribe sees create and decide; unsubscribe stops it; bad listeners are ignored", () => {
    const s = memStore();
    const seen: string[] = [];
    s.subscribe(() => {
      throw new Error("boom");
    });
    const off = s.subscribe((r) => seen.push(`${r.id}:${r.status}`));
    const a = s.create(req);
    s.decide(a.id, "denied");
    off();
    s.create(req);
    expect(seen).toEqual([`${a.id}:pending`, `${a.id}:denied`]);
  });

  test("expirePending clears requests left by an earlier process", () => {
    const s = memStore();
    const a = s.create(req);
    const b = s.create(req);
    s.decide(b.id, "approved");
    expect(s.expirePending()).toBe(1);
    expect(s.get(a.id)?.status).toBe("expired");
    expect(s.get(b.id)?.status).toBe("approved");
  });
});

function ctx(
  over: { tool?: Partial<ToolRef>; profile?: unknown; seen?: string[]; signal?: AbortSignal } = {},
) {
  const tool: ToolRef = {
    qualifiedName: "gmail-work__send_email",
    accountId: "gmail-work",
    serverId: "gmail",
    toolName: "send_email",
    description: "",
    inputSchema: {},
    hash: "h",
    trust: ["can-send"],
    annotations: { readOnlyHint: false, destructiveHint: false },
    ...over.tool,
  };
  const c: CallContext = {
    requestId: "r1",
    profileId: "all",
    profile: ProfileDef.parse(over.profile ?? {}),
    session: {
      id: "s1",
      profileId: "all",
      placeholders: new Map(),
      reverse: new Map(),
      seenTrust: new Set(over.seen ?? []),
    },
    tool,
    modelArgs: {},
    args: {},
    decisions: [],
    masks: [],
    startedAt: 0,
    signal: over.signal ?? new AbortController().signal,
  };
  return c;
}

async function rejection(p: Promise<unknown>): Promise<GatewayError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GatewayError);
    return e as GatewayError;
  }
  throw new Error("expected a rejection");
}

describe("policyStep", () => {
  test("allow passes and records the decision", async () => {
    const approvals = memStore();
    const c = ctx();
    await policyStep({ approvals }).run(c);
    expect(c.decisions).toEqual([{ step: "policy", outcome: "allow", reason: expect.any(String) }]);
    expect(approvals.list()).toEqual([]);
  });

  test("deny throws a plain message without creating a request", async () => {
    const approvals = memStore();
    const c = ctx({ profile: { deny: ["gmail-*"] } });
    const e = await rejection(policyStep({ approvals }).run(c));
    expect(e.code).toBe("denied");
    expect(e.message).toContain("deny list");
    expect(approvals.list()).toEqual([]);
  });

  test("ask after external content: approved by the user", async () => {
    const approvals = memStore();
    approvals.subscribe((r) => {
      if (r.status === "pending") queueMicrotask(() => approvals.decide(r.id, "approved"));
    });
    const c = ctx({ seen: ["external-content"] });
    await policyStep({ approvals }).run(c);
    expect(c.decisions.map((d) => d.outcome)).toEqual(["ask", "allow"]);
    const [r] = approvals.list();
    expect(r).toMatchObject({ status: "approved", profileId: "all", tool: "gmail-work__send_email" });
    expect(r?.reason).toContain("outside content");
  });

  test("ask: declined by the user", async () => {
    const approvals = memStore();
    approvals.subscribe((r) => {
      if (r.status === "pending") queueMicrotask(() => approvals.decide(r.id, "denied"));
    });
    const e = await rejection(policyStep({ approvals }).run(ctx({ seen: ["external-content"] })));
    expect(e.code).toBe("denied");
    expect(e.message).toContain("The user declined");
  });

  test("ask: no answer before the timeout counts as denied", async () => {
    const approvals = memStore();
    const c = ctx({ seen: ["external-content"] });
    const e = await rejection(policyStep({ approvals, timeoutMs: 20 }).run(c));
    expect(e.code).toBe("approval-required");
    expect(e.message).toContain("nobody answered");
    expect(approvals.list()[0]?.status).toBe("expired");
    expect(c.decisions.at(-1)?.outcome).toBe("deny");
  });

  test("timeout comes from the profile by default", async () => {
    const approvals = memStore();
    const c = ctx({ seen: ["external-content"], profile: { policy: { approvalTimeout: 5 } } });
    const ac = new AbortController();
    c.signal = ac.signal;
    const running = policyStep({ approvals }).run(c);
    ac.abort();
    const e = await rejection(running);
    expect(e.message).toContain("within 5 seconds");
  });
});

describe("dataFlowStep", () => {
  test("adds the tool's trust to the session", async () => {
    const c = ctx({ tool: { trust: ["external-content", "private-data"] } });
    await dataFlowStep.run(c);
    expect([...c.session.seenTrust].sort()).toEqual(["external-content", "private-data"]);
  });

  test("a web read then a send asks under balanced", async () => {
    const approvals = memStore();
    const read = ctx({ tool: { trust: ["external-content"], annotations: { readOnlyHint: true } } });
    await policyStep({ approvals }).run(read);
    await dataFlowStep.run(read);
    const send = ctx({ seen: [...read.session.seenTrust] });
    const e = await rejection(policyStep({ approvals, timeoutMs: 10 }).run(send));
    expect(e.code).toBe("approval-required");
  });
});
