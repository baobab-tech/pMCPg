import { describe, expect, test } from "bun:test";
import { type PrivacyLevel, ProfileDef } from "../../src/core/config.ts";
import { GatewayError, type ToolRef, type ToolResult } from "../../src/core/types.ts";
import { type CallContext, runPipeline } from "../../src/pipeline/step.ts";
import {
  MAX_PLACEHOLDERS,
  maskText,
  newSession,
  placeholderFor,
  rehydrateText,
  SECRET_PLACEHOLDER,
  sessionTag,
} from "../../src/privacy/mask.ts";
import { maskStep, rehydrateStep, secretScanStep } from "../../src/privacy/steps.ts";

const TOOL: ToolRef = {
  qualifiedName: "crm__get_contact",
  accountId: "crm",
  serverId: "crm",
  toolName: "get_contact",
  description: "",
  inputSchema: {},
  hash: "x",
  trust: [],
};

function ctx(
  args: Record<string, unknown>,
  privacy: PrivacyLevel = "standard",
  privacyOptions: Record<string, unknown> = {},
  session = newSession(),
): CallContext {
  return {
    requestId: "r1",
    profileId: "work",
    profile: ProfileDef.parse({ privacy, privacyOptions }),
    session,
    tool: TOOL,
    modelArgs: args,
    args: {},
    decisions: [],
    masks: [],
    startedAt: 0,
    signal: new AbortController().signal,
  };
}

const steps = [rehydrateStep, secretScanStep, maskStep];
const text = (r: ToolResult) => (r.content[0] as { text: string }).text;
const ghp = `${"ghp"}_R7k2mQx9Lp4vT8nW3zY6bH1cF5jD0sAeGuIo`;
/** Adds the session tag to every "[TYPE_n]" in `s`: tag(session, "[EMAIL_1]") is "[EMAIL_1_k7qx]". */
const tag = (session: ReturnType<typeof newSession>, s: string) =>
  s.replace(/\[([A-Z_]+_\d+)\]/g, `[$1_${sessionTag(session)}]`);

describe("placeholders", () => {
  test("stable per session and numbered per type", async () => {
    const s = newSession();
    const a = await maskText("jane@acme.com, bob@acme.com, jane@acme.com, +44 20 7946 0958", s, {
      level: "standard",
      secrets: true,
    });
    expect(a).toBe(tag(s, "[EMAIL_1], [EMAIL_2], [EMAIL_1], [PHONE_1]"));
    expect(await maskText("again bob@acme.com", s, { level: "standard", secrets: true })).toBe(
      tag(s, "again [EMAIL_2]"),
    );
    expect(s.placeholders.get(tag(s, "[EMAIL_2]"))).toBe("bob@acme.com");
    expect(s.reverse.get("bob@acme.com")).toBe(tag(s, "[EMAIL_2]"));
  });

  test("the tag is four base-36 characters and differs between sessions", () => {
    const a = newSession(crypto.randomUUID());
    const b = newSession(crypto.randomUUID());
    expect(sessionTag(a)).toMatch(/^[a-z0-9]{4}$/);
    expect(sessionTag(a)).toBe(sessionTag(a));
    expect(sessionTag(a)).not.toBe(sessionTag(b));
  });

  test("sessions do not share numbering or values; another session's placeholder is unknown", async () => {
    const a = newSession("a");
    const b = newSession("b");
    const pa = placeholderFor(a, "EMAIL", "x@y.org");
    const pb = placeholderFor(b, "EMAIL", "other@y.org");
    expect(pa).toBe(tag(a, "[EMAIL_1]"));
    expect(pb).toBe(tag(b, "[EMAIL_1]"));
    expect(pa).not.toBe(pb);
    expect(rehydrateText(pb, b).text).toBe("other@y.org");
    // A restart gives a new session: the old placeholder must not restore the new session's EMAIL_1.
    expect(rehydrateText(pa, b)).toEqual({ text: pa, count: 0, blocked: [], unknown: [pa] });
  });

  test("numbering continues from a session's existing placeholders", () => {
    const s = newSession();
    s.placeholders.set(tag(s, "[PHONE_7]"), "+1 613 555 0142");
    expect(placeholderFor(s, "PHONE", "+1 613 555 0199")).toBe(tag(s, "[PHONE_8]"));
  });

  test("secrets get a fixed placeholder and are never stored", () => {
    const s = newSession();
    expect(placeholderFor(s, "SECRET", ghp)).toBe(SECRET_PLACEHOLDER);
    expect(s.placeholders.size).toBe(0);
  });

  test("unknown placeholders are left in the text and listed; other bracketed text is ignored", () => {
    const s = newSession();
    placeholderFor(s, "EMAIL", "x@y.org");
    const r = rehydrateText(`${tag(s, "[EMAIL_1] [EMAIL_9] [SECRET_REDACTED] [FOO_1]")} [EMAIL_2]`, s);
    expect(r.text).toBe(`${tag(s, "x@y.org [EMAIL_9] [SECRET_REDACTED] [FOO_1]")} [EMAIL_2]`);
    expect(r.unknown).toEqual([tag(s, "[EMAIL_9]")]);
  });

  test("the map is capped: the least recently used placeholder is dropped and its number not reused", () => {
    const s = newSession();
    const first = placeholderFor(s, "EMAIL", "first@y.org");
    const second = placeholderFor(s, "EMAIL", "second@y.org");
    for (let i = 0; i < MAX_PLACEHOLDERS - 2; i++) placeholderFor(s, "IP", `10.0.${i >> 8}.${i & 255}`);
    // Using `first` again makes `second` the oldest.
    expect(rehydrateText(first, s).count).toBe(1);
    placeholderFor(s, "EMAIL", "third@y.org");
    expect(s.placeholders.size).toBe(MAX_PLACEHOLDERS);
    expect(s.placeholders.has(first)).toBe(true);
    expect(rehydrateText(second, s).unknown).toEqual([second]);
    expect(s.reverse.has("second@y.org")).toBe(false);
    // Seen again, the value gets a new number, so the dropped placeholder never points at another value.
    expect(placeholderFor(s, "EMAIL", "second@y.org")).toBe(tag(s, "[EMAIL_4]"));
  });

  test("unknown placeholders are found even when the session holds nothing yet", () => {
    const old = newSession("before-restart");
    const p = placeholderFor(old, "EMAIL", "x@y.org");
    expect(rehydrateText(p, newSession("after-restart")).unknown).toEqual([p]);
  });
});

describe("pipeline round trip", () => {
  test("result masked, placeholder in next call restored before forwarding", async () => {
    const session = newSession();
    // Call 1: the server returns personal data; the model sees placeholders.
    const c1 = ctx({ query: "Wanjiku" }, "strict", {}, session);
    const r1 = await runPipeline(c1, steps, async () => ({
      content: [
        { type: "text", text: "Name: Wanjiku Kamau\nEmail: wanjiku@shirika.or.ke\nPhone: +254 712 345 678" },
      ],
      structuredContent: {
        contact: { email: "wanjiku@shirika.or.ke", phones: ["+254 712 345 678"], visits: 3 },
      },
    }));
    expect(text(r1)).toBe(tag(session, "Name: [PERSON_1]\nEmail: [EMAIL_1]\nPhone: [PHONE_1]"));
    expect(r1.structuredContent).toEqual({
      contact: { email: tag(session, "[EMAIL_1]"), phones: [tag(session, "[PHONE_1]")], visits: 3 },
    });
    expect(c1.masks.every((m) => m.where === "result")).toBe(true);
    expect(JSON.stringify(c1.masks)).not.toContain("shirika");
    expect(JSON.stringify(c1.decisions)).not.toContain("shirika");

    // Call 2: the model uses the placeholders; the server receives real values.
    const c2 = ctx(
      { to: tag(session, "[EMAIL_1]"), body: tag(session, "Hello [PERSON_1], we will call [PHONE_1].") },
      "strict",
      {},
      session,
    );
    let seen: Record<string, unknown> = {};
    const r2 = await runPipeline(c2, steps, async (c) => {
      seen = c.args;
      return { content: [{ type: "text", text: `Sent to ${String(c.args.to)}` }] };
    });
    expect(seen).toEqual({
      to: "wanjiku@shirika.or.ke",
      body: "Hello Wanjiku Kamau, we will call +254 712 345 678.",
    });
    expect(c2.modelArgs.to).toBe(tag(session, "[EMAIL_1]"));
    expect(text(r2)).toBe(tag(session, "Sent to [EMAIL_1]"));
    expect(c2.decisions.map((d) => d.step)).toEqual(["rehydrate", "mask"]);
  });

  test("a placeholder from before a restart is refused, not restored to a new value or sent as text", async () => {
    // Run 1: the model sees jane's address as EMAIL_1.
    const before = newSession(crypto.randomUUID());
    const r1 = await runPipeline(ctx({}, "standard", {}, before), steps, async () => ({
      content: [{ type: "text", text: "jane@acme.com" }],
    }));
    const old = text(r1);
    // Run 2 (after a restart): another address is numbered EMAIL_1 in the new session.
    const after = newSession(crypto.randomUUID());
    await runPipeline(ctx({}, "standard", {}, after), steps, async () => ({
      content: [{ type: "text", text: "bob@acme.com" }],
    }));
    // The model, still holding run 1's placeholder, sends it.
    const c = ctx({ to: old }, "standard", {}, after);
    let forwarded = false;
    const err = await runPipeline(c, steps, async () => {
      forwarded = true;
      return { content: [] };
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("invalid-arguments");
    expect(err.message).toContain(old);
    expect(err.message).not.toContain("acme.com");
    expect(forwarded).toBe(false);
    expect(c.decisions.at(-1)).toMatchObject({ step: "rehydrate", outcome: "deny" });
  });

  test("off: nothing masked but placeholders still restored and secrets still redacted", async () => {
    const session = newSession();
    placeholderFor(session, "EMAIL", "a@b.org");
    const c = ctx({ to: tag(session, "[EMAIL_1]") }, "off", {}, session);
    const r = await runPipeline(c, steps, async (x) => ({
      content: [{ type: "text", text: `${String(x.args.to)} ${ghp}` }],
    }));
    expect(text(r)).toBe(`a@b.org ${SECRET_PLACEHOLDER}`);
  });

  test("allow, skipTypes and skipFields", async () => {
    const c = ctx({}, "standard", {
      allow: ["Me@MyNgo.org"],
      skipTypes: ["IP"],
      skipFields: ["contact_id"],
    });
    const r = await runPipeline(c, steps, async () => ({
      content: [{ type: "text", text: "me@myngo.org wrote to you@x.org from 8.8.8.8" }],
      structuredContent: { contact_id: "jane@acme.com", other: "jane@acme.com" },
    }));
    expect(text(r)).toBe(tag(c.session, "me@myngo.org wrote to [EMAIL_1] from 8.8.8.8"));
    expect(r.structuredContent).toEqual({ contact_id: "jane@acme.com", other: tag(c.session, "[EMAIL_2]") });
  });

  test("skipAccounts leaves PII but redacts secrets", async () => {
    const c = ctx({}, "strict", { skipAccounts: ["crm"] });
    const r = await runPipeline(c, steps, async () => ({
      content: [{ type: "text", text: `jane@acme.com ${ghp}` }],
    }));
    expect(text(r)).toBe(`jane@acme.com ${SECRET_PLACEHOLDER}`);
  });

  test("secretsInResults off lets secrets through", async () => {
    const c = ctx({}, "off", { secretsInResults: "off" });
    const r = await runPipeline(c, steps, async () => ({ content: [{ type: "text", text: ghp }] }));
    expect(text(r)).toBe(ghp);
    expect(c.masks).toEqual([]);
  });

  test("images and blobs pass through; embedded text resources are masked", async () => {
    const c = ctx({});
    const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
    const r = await runPipeline(c, steps, async () => ({
      content: [
        image,
        { type: "resource", resource: { uri: "file:///a.txt", text: "jane@acme.com" } },
        { type: "resource", resource: { uri: "file:///b.bin", blob: "AAAA" } },
      ],
    }));
    expect(r.content[0]).toEqual(image);
    expect(r.content[1]).toEqual({
      type: "resource",
      resource: { uri: "file:///a.txt", text: tag(c.session, "[EMAIL_1]") },
    });
    expect(r.content[2]).toEqual({ type: "resource", resource: { uri: "file:///b.bin", blob: "AAAA" } });
  });

  test("error results are masked too", async () => {
    const c = ctx({});
    const r = await runPipeline(c, steps, async () => ({
      content: [{ type: "text", text: "No account for jane@acme.com" }],
      isError: true,
    }));
    expect(text(r)).toBe(tag(c.session, "No account for [EMAIL_1]"));
    expect(r.isError).toBe(true);
  });

  test("deeply nested structured content is still masked", async () => {
    let deep: unknown = "jane@acme.com";
    for (let i = 0; i < 100; i++) deep = { n: deep };
    const c = ctx({});
    const r = await runPipeline(c, steps, async () => ({
      content: [],
      structuredContent: { deep } as Record<string, unknown>,
    }));
    expect(JSON.stringify(r.structuredContent)).not.toContain("jane@acme.com");
    expect(JSON.stringify(r.structuredContent)).toContain(tag(c.session, "[EMAIL_1]"));
  });
});

describe("secret scan on arguments", () => {
  test("blocks by default and never forwards", async () => {
    const c = ctx({ body: `here is my token ${ghp}` });
    let forwarded = false;
    const err = await runPipeline(c, steps, async () => {
      forwarded = true;
      return { content: [] };
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("denied");
    expect(err.message).toContain("github-pat");
    expect(err.message).not.toContain(ghp);
    expect(forwarded).toBe(false);
    expect(c.decisions.at(-1)).toMatchObject({ step: "secret-scan", outcome: "deny" });
  });

  test("redact mode replaces the secret and forwards", async () => {
    const c = ctx({ nested: { list: [`key ${ghp} end`] } }, "standard", { secretsInArguments: "redact" });
    let seen: unknown;
    await runPipeline(c, steps, async (x) => {
      seen = x.args;
      return { content: [] };
    });
    expect(seen).toEqual({ nested: { list: [`key ${SECRET_PLACEHOLDER} end`] } });
    expect(c.masks).toEqual([{ type: "SECRET", placeholder: SECRET_PLACEHOLDER, where: "arguments" }]);
  });

  test("off mode forwards secrets unchanged", async () => {
    const c = ctx({ body: ghp }, "standard", { secretsInArguments: "off" });
    let seen: unknown;
    await runPipeline(c, steps, async (x) => {
      seen = x.args;
      return { content: [] };
    });
    expect(seen).toEqual({ body: ghp });
  });

  test("rehydrated personal data is not treated as a secret", async () => {
    const session = newSession();
    placeholderFor(session, "EMAIL", "jane@acme.com");
    placeholderFor(session, "CARD", "4111 1111 1111 1111");
    const c = ctx({ to: tag(session, "[EMAIL_1]"), card: tag(session, "[CARD_1]") }, "standard", {}, session);
    let seen: unknown;
    await runPipeline(c, steps, async (x) => {
      seen = x.args;
      return { content: [] };
    });
    expect(seen).toEqual({ to: "jane@acme.com", card: "4111 1111 1111 1111" });
  });
});
