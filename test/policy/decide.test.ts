// biome-ignore-all lint/suspicious/noThenProperty: rules use `then` (the config.yaml syntax); values are strings
import { describe, expect, test } from "bun:test";
import { Config, ProfileDef, TrustLevel } from "../../src/core/config.ts";
import type { ToolAnnotations } from "../../src/core/types.ts";
import { type DecideInput, decide, describeRule, matchGlob, searchable } from "../../src/policy/decide.ts";
import { PolicyDef, Rule, TRUST_LEVELS } from "../../src/policy/schema.ts";

type Trust = (typeof TRUST_LEVELS)[number];

function profile(policy: unknown = {}, extra: Record<string, unknown> = {}): ProfileDef {
  return ProfileDef.parse({ policy, ...extra });
}

function tool(name: string, annotations?: ToolAnnotations, trust: Trust[] = []): DecideInput["tool"] {
  const [, toolName = name] = name.split("__");
  return { qualifiedName: name, toolName, trust, ...(annotations ? { annotations } : {}) };
}

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };

const outcome = (p: ProfileDef, t: DecideInput["tool"], seen: Trust[] = []) =>
  decide({ profile: p, tool: t, seenTrust: new Set(seen) }).outcome;

describe("schema", () => {
  test("defaults and the starter shape stay valid", () => {
    expect(PolicyDef.parse(undefined)).toEqual({ preset: "balanced", rules: [], approvalTimeout: 120 });
    expect(PolicyDef.parse({ preset: "careful", rules: [] }).preset).toBe("careful");
    expect(ProfileDef.parse({}).policy.preset).toBe("balanced");
  });

  test("trust levels match core/config.ts", () => {
    expect([...TRUST_LEVELS]).toEqual(TrustLevel.options);
  });

  test("accepts single values and lists", () => {
    const r = Rule.parse({
      when: {
        tool: ["a__*", "b"],
        annotation: "destructive",
        trust: ["can-send"],
        after: "external-content",
      },
      then: "deny",
    });
    expect(r.when.tool).toEqual(["a__*", "b"]);
    expect(Rule.parse({ then: "ask" }).when).toEqual({});
  });

  test("errors are readable and point at the field", () => {
    const bad = Config.safeParse({
      profiles: {
        p: {
          policy: {
            preset: "strict",
            approvalTimeout: 1,
            rules: [
              { when: { annotaton: "destructive" }, then: "ask" },
              { when: { trust: "sends" }, then: "maybe" },
              { when: { tool: [] }, then: "allow" },
            ],
          },
        },
      },
    });
    expect(bad.success).toBe(false);
    const lines = bad.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];
    const text = lines.join("\n");
    expect(text).toContain("profiles.p.policy.preset: must be open, balanced or careful");
    expect(text).toContain("profiles.p.policy.approvalTimeout: must be at least 5 seconds");
    expect(text).toMatch(/profiles\.p\.policy\.rules\.0\.when: .*annotaton/);
    expect(text).toContain("profiles.p.policy.rules.1.then: must be allow, ask or deny");
    expect(text).toContain("profiles.p.policy.rules.1.when.trust");
    expect(text).toContain("profiles.p.policy.rules.2.when.tool");
  });
});

describe("presets", () => {
  // [tool annotations, server trust, seen in session, open, balanced, careful]
  type O = "allow" | "ask" | "deny";
  const table: [string, ToolAnnotations | undefined, Trust[], Trust[], O, O, O][] = [
    ["read-only", READ, [], [], "allow", "allow", "allow"],
    ["write", WRITE, [], [], "allow", "allow", "ask"],
    ["destructive", DESTRUCTIVE, [], [], "allow", "ask", "ask"],
    ["unannotated (spec: destructive)", undefined, [], [], "allow", "ask", "ask"],
    ["read-only, can-send server", READ, ["can-send"], [], "allow", "allow", "ask"],
    ["read-only, can-send, after external", READ, ["can-send"], ["external-content"], "allow", "ask", "ask"],
    ["write, can-send, after private-data", WRITE, ["can-send"], ["private-data"], "allow", "allow", "ask"],
    [
      "read-only, external server, after external",
      READ,
      ["external-content"],
      ["external-content"],
      "allow",
      "allow",
      "allow",
    ],
  ];
  for (const [name, ann, trust, seen, open, balanced, careful] of table) {
    test(name, () => {
      const t = tool("acct__x", ann, trust);
      expect(outcome(profile({ preset: "open" }), t, seen)).toBe(open);
      expect(outcome(profile({ preset: "balanced" }), t, seen)).toBe(balanced);
      expect(outcome(profile({ preset: "careful" }), t, seen)).toBe(careful);
    });
  }

  test("every decision explains itself in one sentence", () => {
    for (const preset of ["open", "balanced", "careful"])
      for (const ann of [READ, WRITE, DESTRUCTIVE, undefined])
        for (const seen of [[], ["external-content"]] as Trust[][]) {
          const d = decide({
            profile: profile({ preset }),
            tool: tool("a__x", ann, ["can-send"]),
            seenTrust: new Set(seen),
          });
          expect(d.reason).toMatch(/^[A-Z][^.]*(\([^)]*\))?[^.]*\.$/);
          expect(d.rule.length).toBeGreaterThan(0);
        }
  });

  test("labels name the preset rule that fired", () => {
    const d = decide({ profile: profile(), tool: tool("a__x", DESTRUCTIVE) });
    expect(d).toEqual({
      outcome: "ask",
      reason: "This tool may delete or overwrite data.",
      rule: "balanced #1",
    });
    expect(decide({ profile: profile(), tool: tool("a__x", READ) }).rule).toBe("default");
  });
});

describe("rule matching", () => {
  const custom = (when: unknown, then = "deny") => profile({ preset: "open", rules: [{ when, then }] });

  test("tool globs: with __ match the qualified name, without match the tool part", () => {
    const send = tool("gmail-work__send_email", READ);
    expect(outcome(custom({ tool: "gmail-*__send_*" }), send)).toBe("deny");
    expect(outcome(custom({ tool: "send_*" }), send)).toBe("deny");
    expect(outcome(custom({ tool: "gmail-home__*" }), send)).toBe("allow");
    expect(outcome(custom({ tool: "send" }), send)).toBe("allow");
    expect(outcome(custom({ tool: ["x", "*_email"] }), send)).toBe("deny");
  });

  test("globs treat regex characters literally", () => {
    expect(matchGlob("a.b", "a.b")).toBe(true);
    expect(matchGlob("a.b", "axb")).toBe(false);
    expect(matchGlob("a(b)?", "a(b)?")).toBe(true);
    expect(matchGlob("*", "")).toBe(true);
  });

  test("annotations", () => {
    expect(outcome(custom({ annotation: "read-only" }), tool("a__x", READ))).toBe("deny");
    expect(outcome(custom({ annotation: "read-only" }), tool("a__x"))).toBe("allow");
    expect(outcome(custom({ annotation: "write" }), tool("a__x", WRITE))).toBe("deny");
    expect(outcome(custom({ annotation: "destructive" }), tool("a__x", WRITE))).toBe("allow");
    expect(outcome(custom({ annotation: "destructive" }), tool("a__x", { readOnlyHint: false }))).toBe(
      "deny",
    );
    // readOnlyHint wins over a stray destructiveHint
    expect(
      outcome(
        custom({ annotation: "destructive" }),
        tool("a__x", { readOnlyHint: true, destructiveHint: true }),
      ),
    ).toBe("allow");
    expect(outcome(custom({ annotation: ["read-only", "destructive"] }), tool("a__x", DESTRUCTIVE))).toBe(
      "deny",
    );
  });

  test("trust: any listed level of the tool's server", () => {
    const t = tool("a__x", READ, ["private-data", "can-send"]);
    expect(outcome(custom({ trust: "can-send" }), t)).toBe("deny");
    expect(outcome(custom({ trust: ["local", "private-data"] }), t)).toBe("deny");
    expect(outcome(custom({ trust: "external-content" }), t)).toBe("allow");
  });

  test("after: any listed level seen earlier in the session", () => {
    const p = custom({ after: ["external-content", "private-data"] });
    const t = tool("a__x", READ);
    expect(outcome(p, t)).toBe("allow");
    expect(outcome(p, t, ["local"])).toBe("allow");
    expect(outcome(p, t, ["private-data"])).toBe("deny");
  });

  test("all conditions in one rule must hold", () => {
    const p = custom({ tool: "*send*", trust: "can-send", after: "external-content" });
    expect(outcome(p, tool("a__send", READ, ["can-send"]), ["external-content"])).toBe("deny");
    expect(outcome(p, tool("a__send", READ, ["can-send"]))).toBe("allow");
    expect(outcome(p, tool("a__send", READ), ["external-content"])).toBe("allow");
    expect(outcome(p, tool("a__read", READ, ["can-send"]), ["external-content"])).toBe("allow");
  });

  test("a rule without when matches every call", () => {
    expect(outcome(profile({ preset: "open", rules: [{ then: "ask" }] }), tool("a__x", READ))).toBe("ask");
  });
});

describe("ordering", () => {
  test("first match wins among custom rules", () => {
    const p = profile({
      rules: [
        { when: { tool: "a__safe" }, then: "allow" },
        { when: { tool: "a__*" }, then: "deny", reason: "No a tools." },
      ],
    });
    expect(decide({ profile: p, tool: tool("a__safe", DESTRUCTIVE) })).toMatchObject({
      outcome: "allow",
      rule: "custom #1",
    });
    expect(decide({ profile: p, tool: tool("a__other", READ) })).toEqual({
      outcome: "deny",
      reason: "No a tools.",
      rule: "custom #2",
    });
  });

  test("custom rules run before preset rules, both ways", () => {
    const relax = profile({ preset: "careful", rules: [{ when: { tool: "notes__*" }, then: "allow" }] });
    expect(outcome(relax, tool("notes__write", DESTRUCTIVE, ["can-send"]))).toBe("allow");
    expect(outcome(relax, tool("other__write", DESTRUCTIVE))).toBe("ask");
    const tighten = profile({ preset: "open", rules: [{ when: { trust: "can-send" }, then: "ask" }] });
    expect(outcome(tighten, tool("mail__search", READ, ["can-send"]))).toBe("ask");
  });

  test("generated reason when a custom rule has none", () => {
    const p = profile({ rules: [{ when: { tool: "gmail-*__send_*" }, then: "ask" }] });
    expect(decide({ profile: p, tool: tool("gmail-w__send_x", READ) }).reason).toBe(
      'Ask before calling tools named "gmail-*__send_*".',
    );
  });
});

describe("readOnly and deny", () => {
  test("deny globs block before any rule, including custom allow", () => {
    const p = profile({ preset: "open", rules: [{ then: "allow" }] }, { deny: ["gmail-work__delete_*"] });
    expect(decide({ profile: p, tool: tool("gmail-work__delete_mail", READ) })).toMatchObject({
      outcome: "deny",
      rule: "deny-list",
    });
    expect(outcome(p, tool("gmail-home__delete_mail", READ))).toBe("allow");
  });

  test("read-only profile: only readOnlyHint tools pass, custom allow cannot override", () => {
    const p = profile({ preset: "open", rules: [{ then: "allow" }] }, { readOnly: true });
    expect(outcome(p, tool("a__x", READ))).toBe("allow");
    for (const ann of [WRITE, DESTRUCTIVE, undefined, {}])
      expect(decide({ profile: p, tool: tool("a__x", ann) })).toMatchObject({
        outcome: "deny",
        rule: "read-only",
      });
  });

  test("read-only tools still meet rules after the read-only gate", () => {
    const p = profile({ preset: "careful" }, { readOnly: true });
    expect(outcome(p, tool("a__x", READ, ["can-send"]))).toBe("ask");
  });

  test("searchable hides only tools blocked without session state", () => {
    const p = profile(
      { rules: [{ when: { after: "external-content" }, then: "deny" }] },
      { deny: ["a__hidden"] },
    );
    expect(searchable(p, tool("a__hidden", READ))).toBe(false);
    expect(searchable(p, tool("a__x", READ))).toBe(true);
    expect(searchable(profile({}, { readOnly: true }), tool("a__x", WRITE))).toBe(false);
  });
});

describe("describeRule", () => {
  const d = (r: unknown) => describeRule(Rule.parse(r));
  test("plain sentences", () => {
    expect(d({ then: "ask" })).toBe("Ask before calling every tool.");
    expect(d({ when: { annotation: "destructive" }, then: "deny" })).toBe(
      "Block tools that may delete or overwrite data.",
    );
    expect(d({ when: { tool: ["a__*", "b"], trust: ["can-send", "private-data"] }, then: "allow" })).toBe(
      'Allow tools named "a__*" or "b" from servers that can send data out or hold private data.',
    );
    expect(d({ when: { trust: "can-send", after: "external-content" }, then: "ask" })).toBe(
      "Ask before calling tools from servers that can send data out, once this session has read outside content (web pages, emails, documents).",
    );
  });
});
