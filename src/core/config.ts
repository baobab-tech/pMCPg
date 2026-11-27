// Config contract: the shape of config.yaml. Types are inferred from these schemas.
// Owner: core (Phase 0). Change only through the main session.
import { z } from "zod";
import { PolicyDef } from "../policy/schema.ts";
import { PrivacyOptions } from "../privacy/schema.ts";

/** Reference to a value in the vault, written as "vault:<key>" in config.yaml. */
export const SecretRef = z.string().regex(/^vault:[\w./@-]+$/, "must look like vault:<key>");
export type SecretRef = z.infer<typeof SecretRef>;

/** Lowercase slug used in URLs and namespaced tool names. No "__" or "@" allowed. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "lowercase letters, digits and single dashes");

/** Agent Skills name: 1 to 64 lowercase letters, digits and single dashes. Also the library folder name. */
export const SkillName = z
  .string()
  .regex(
    /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    "1 to 64 lowercase letters, digits and single dashes",
  );

export const TrustLevel = z.enum(["local", "private-data", "external-content", "can-send"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const PrivacyLevel = z.enum(["off", "standard", "strict"]);
export type PrivacyLevel = z.infer<typeof PrivacyLevel>;

const StdioServer = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Plain values or SecretRefs. SecretRefs resolve per account at spawn time. */
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
});

const RemoteServer = z.object({
  transport: z.enum(["http", "sse"]),
  url: z.url(),
});

export const ServerDef = z.discriminatedUnion("transport", [StdioServer, RemoteServer]).and(
  z.object({
    name: z.string().optional(),
    trust: z.array(TrustLevel).default([]),
    /** Allow plain http for this URL (localhost and private addresses only). */
    allowInsecure: z.boolean().default(false),
  }),
);
export type ServerDef = z.infer<typeof ServerDef>;

export const AccountAuth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  /** Header values may contain {{vault:key}} placeholders. */
  z.object({ type: z.literal("header"), headers: z.record(z.string(), z.string()) }),
  /** Tokens and client registration live in the vault under account/<id>/oauth/*. */
  z.object({
    type: z.literal("oauth"),
    scopes: z.array(z.string()).optional(),
    clientId: z.string().optional(),
  }),
]);
export type AccountAuth = z.infer<typeof AccountAuth>;

export const AccountDef = z.object({
  server: Slug,
  label: z.string().optional(),
  auth: AccountAuth.default({ type: "none" }),
  /** Extra env for stdio servers, per account (e.g. API keys as SecretRefs). */
  env: z.record(z.string(), z.string()).default({}),
  /**
   * Query parameters added to every request to a remote server, per account (e.g. `?apiKey=`),
   * plain values or SecretRefs. Keeps keys out of the server URL in config.yaml.
   */
  urlParams: z.record(z.string(), z.string()).optional(),
  /**
   * Skills the server publishes (MCP Skills extension), passed through to profiles that hold this account.
   * off (or absent): none. text: Markdown and plain-text files only. all: every file, scripts included.
   * See docs/skills.md.
   */
  skills: z.enum(["off", "text", "all"]).optional(),
});
export type AccountDef = z.infer<typeof AccountDef>;

export const ProfileDef = z.object({
  name: z.string().optional(),
  accounts: z.array(Slug).default([]),
  privacy: PrivacyLevel.default("standard"),
  /** Fine-tuning for masking. Schema owned by src/privacy/schema.ts. */
  privacyOptions: PrivacyOptions,
  /** Approvals and data-flow rules. Schema owned by src/policy/schema.ts. */
  policy: PolicyDef,
  readOnly: z.boolean().default(false),
  /** Tools hidden from this profile, as qualified names or globs ("gmail-work__delete_*"). */
  deny: z.array(z.string()).default([]),
  /** Library skills served to this profile, by name. "all" always holds every library skill. */
  skills: z.array(SkillName).optional(),
});
export type ProfileDef = z.infer<typeof ProfileDef>;

export const Config = z.object({
  version: z.literal(1).default(1),
  gateway: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(7431),
    })
    .default({ host: "127.0.0.1", port: 7431 }),
  servers: z.record(Slug, ServerDef).default({}),
  accounts: z.record(Slug, AccountDef).default({}),
  /** "all" is reserved: it always contains every account and is created implicitly. */
  profiles: z.record(Slug, ProfileDef).default({}),
});
export type Config = z.infer<typeof Config>;

export const ALL_PROFILE = "all";
