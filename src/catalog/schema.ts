// Catalog contract: the signed file at CATALOG_URL (docs/catalog.md). Shared by the website build,
// the gateway's fetch and the web UI. Change only through the main session.
//
// An entry is a subset of the official MCP Registry server.json (schema 2025-12-11) plus pMCPg's review
// under _meta["io.pmcpg/curation"]. The file holds names of credentials, never values.
import { z } from "zod";
import { PrivacyLevel, Slug, TrustLevel } from "../core/config.ts";
import { PolicyPreset, Rule } from "../policy/schema.ts";

export const CATALOG_FORMAT = 1;
export const CURATION_KEY = "io.pmcpg/curation";

/** Exact version: 1.2.3, 1.2.3-beta.1, 1.2.3+build. No "latest", no ranges. */
export const ExactVersion = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "must be an exact version such as 1.2.3 (no latest, no ranges)",
  );

export const HttpsUrl = z
  .url({ protocol: /^https$/, error: "must be an https URL" })
  .refine((u) => !new URL(u).username && !new URL(u).password, "must not hold a user name or password");

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest");

/** Official registry name: reverse-DNS namespace, a slash, then the server name. */
export const EntryName = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/, "must look like io.github.owner/server");

/** Environment or header name. */
const VarName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/, "must be a variable or header name");

/** An environment variable a package reads. A secret never carries a default. */
export const EnvVar = z
  .strictObject({
    name: VarName,
    description: z.string().max(500).optional(),
    isRequired: z.boolean().default(false),
    isSecret: z.boolean().default(false),
    format: z.enum(["string", "number", "boolean", "filepath"]).optional(),
    default: z.string().max(500).optional(),
    choices: z.array(z.string().max(200)).optional(),
  })
  .refine((v) => !(v.isSecret && v.default !== undefined), "a secret variable must not have a default");
export type EnvVar = z.infer<typeof EnvVar>;

/** A header a remote server expects. Names only: values come from the user's vault. */
export const HeaderDef = z.strictObject({
  name: VarName,
  description: z.string().max(500).optional(),
  isRequired: z.boolean().default(false),
  isSecret: z.boolean().default(false),
});
export type HeaderDef = z.infer<typeof HeaderDef>;

/** A fixed package argument. Arguments the user must fill in are not supported. */
export const PackageArgument = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("positional"), value: z.string().min(1).max(500) }),
  z.strictObject({
    type: z.literal("named"),
    name: z.string().regex(/^--?[A-Za-z0-9][\w-]*$/, "must look like --flag"),
    value: z.string().max(500).optional(),
  }),
]);
export type PackageArgument = z.infer<typeof PackageArgument>;

export const RegistryType = z.enum(["npm", "pypi", "oci", "mcpb"]);
export type RegistryType = z.infer<typeof RegistryType>;

/** A package run on the user's computer, approved at one exact version. */
export const PackageDef = z
  .strictObject({
    registryType: RegistryType,
    /** npm/pypi/oci: the package or image name. mcpb: the https download URL. */
    identifier: z.string().min(1).max(300),
    version: ExactVersion,
    /** Required for mcpb; the installer checks the download against it. */
    fileSha256: Sha256.optional(),
    transport: z.strictObject({ type: z.literal("stdio") }).default({ type: "stdio" }),
    packageArguments: z.array(PackageArgument).max(50).default([]),
    environmentVariables: z.array(EnvVar).max(50).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.registryType === "mcpb") {
      if (!p.fileSha256) ctx.addIssue({ code: "custom", path: ["fileSha256"], message: "required for mcpb" });
      if (!HttpsUrl.safeParse(p.identifier).success)
        ctx.addIssue({ code: "custom", path: ["identifier"], message: "must be an https URL for mcpb" });
    } else if (!/^[@a-zA-Z0-9][\w.@/-]*$/.test(p.identifier) || p.identifier.includes("..")) {
      ctx.addIssue({ code: "custom", path: ["identifier"], message: "must be a package or image name" });
    }
  });
export type PackageDef = z.infer<typeof PackageDef>;

/** A remote server, approved per operator and URL. */
export const RemoteDef = z.strictObject({
  type: z.enum(["streamable-http", "sse"]),
  url: HttpsUrl,
  headers: z.array(HeaderDef).max(20).default([]),
});
export type RemoteDef = z.infer<typeof RemoteDef>;

export const Tier = z.enum(["baobab-built", "approved", "community"]);
export type Tier = z.infer<typeof Tier>;

/** How a user signs in. `credentials` are names (env or header) the user fills in, never values. */
export const CatalogAuth = z
  .strictObject({
    type: z.enum(["none", "oauth", "header"]),
    registration: z.enum(["dcr", "cimd", "manual"]).optional(),
    credentials: z.array(VarName).max(20).default([]),
  })
  .refine((a) => a.type === "oauth" || a.registration === undefined, "registration is for oauth only");
export type CatalogAuth = z.infer<typeof CatalogAuth>;

/** pMCPg's review of one entry. */
export const Curation = z.strictObject({
  tier: Tier,
  reviewedAt: z.iso.date(),
  reviewedBy: z.string().min(1).max(100),
  /** Where the entry came from, e.g. its page in the official registry. */
  source: HttpsUrl.optional(),
  auth: CatalogAuth,
  trust: z.array(TrustLevel).default([]),
  privacy: PrivacyLevel.default("standard"),
  /** Rules suggested for profiles that add this server, in config.yaml policy syntax. */
  approvalHints: z.array(Rule).max(20).optional(),
  audience: z.array(Slug).default([]),
  categories: z.array(Slug).default([]),
  samplePrompt: z.string().max(300).optional(),
  /** catalogToolsHash() of the tool list seen at review (remote servers). */
  toolsHash: Sha256.optional(),
});
export type Curation = z.infer<typeof Curation>;

export const Icon = z.strictObject({
  src: HttpsUrl,
  mimeType: z.enum(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]).optional(),
  sizes: z.array(z.string().regex(/^(\d+x\d+|any)$/)).optional(),
  theme: z.enum(["light", "dark"]).optional(),
});

export const Entry = z
  .object({
    name: EntryName,
    title: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(500),
    /** Version of the entry's server.json (the server's own release). */
    version: z.string().min(1).max(50),
    repository: z
      .object({ url: HttpsUrl, source: z.string().max(50), subfolder: z.string().max(200).optional() })
      .optional(),
    websiteUrl: HttpsUrl.optional(),
    icons: z.array(Icon).max(5).optional(),
    packages: z.array(PackageDef).max(5).default([]),
    remotes: z.array(RemoteDef).max(5).default([]),
    _meta: z.object({ [CURATION_KEY]: Curation }),
  })
  .refine((e) => e.packages.length + e.remotes.length > 0, "needs at least one package or remote");
export type Entry = z.infer<typeof Entry>;

export const Preset = z.strictObject({
  id: Slug,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  audience: z.array(Slug).default([]),
  /** Entry names from the same file. */
  servers: z.array(EntryName).min(1).max(30),
  privacy: PrivacyLevel,
  approvals: PolicyPreset,
});
export type Preset = z.infer<typeof Preset>;

export const CatalogFile = z
  .object({
    format: z.literal(CATALOG_FORMAT),
    /** Goes up with every signed build. The gateway refuses a lower serial than it has seen. */
    serial: z.number().int().min(1),
    generatedAt: z.iso.datetime(),
    expires: z.iso.datetime(),
    servers: z.array(Entry).max(5000),
    presets: z.array(Preset).max(500).default([]),
  })
  .superRefine((c, ctx) => {
    if (Date.parse(c.expires) <= Date.parse(c.generatedAt))
      ctx.addIssue({ code: "custom", path: ["expires"], message: "must be after generatedAt" });
    const names = new Set<string>();
    c.servers.forEach((e, i) => {
      if (names.has(e.name))
        ctx.addIssue({ code: "custom", path: ["servers", i, "name"], message: "duplicate name" });
      names.add(e.name);
    });
    const ids = new Set<string>();
    c.presets.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({ code: "custom", path: ["presets", i, "id"], message: "duplicate id" });
      ids.add(p.id);
      p.servers.forEach((s, j) => {
        if (!names.has(s))
          ctx.addIssue({ code: "custom", path: ["presets", i, "servers", j], message: "unknown server" });
      });
    });
  });
export type CatalogFile = z.infer<typeof CatalogFile>;

/** The catalog as the web UI's API and the CLI see it (GatewayHandle.catalog()). */
export interface CatalogView {
  entries: Entry[];
  presets: Preset[];
  /** 0 when nothing verified is loaded. */
  serial: number;
  /** ISO time the file was fetched or loaded; null when none is loaded. */
  fetchedAt: string | null;
  source: "network" | "cache" | "snapshot";
  /** Why the last fetch failed, in plain words. The view then holds the cache or snapshot. */
  error?: string;
}

export const curation = (e: Entry): Curation => e._meta[CURATION_KEY];
