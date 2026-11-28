// Catalog endpoints under /api/ui: browse the signed catalog and add an entry.
// Registered by createUiApi, so they sit behind the same session, CSRF and Host/Origin checks.
// GET never fetches; only POST /catalog/refresh contacts the catalog URL.
import type { Hono } from "hono";
import { z } from "zod";
import { curation, type Entry } from "../catalog/schema.ts";
import { entrySlug, entryToConfig } from "../catalog/to-config.ts";
import {
  type AccountDef,
  ALL_PROFILE,
  type Config,
  PrivacyLevel,
  type ServerDef,
  Slug,
  TrustLevel,
} from "../core/config.ts";
import { resolveProfile } from "../core/profiles.ts";
import type { GatewayHandle } from "../gateway/handle.ts";

/** What the add flow needs from createUiApi: the same account builder the manual add uses. */
export interface CatalogDeps {
  prepareAccount: (
    server: string,
    aid: string,
    label: string | undefined,
    a: {
      auth: "none" | "oauth" | "header";
      headers: { name: string; value: string }[];
      env: { name: string; value: string; secret: boolean }[];
      clientId?: string;
      clientSecret?: string;
      clientIssuer?: string;
    },
    serverDef?: ServerDef,
  ) => Promise<{ id: string; def: AccountDef }>;
  /** Throws a readable 4xx. */
  fail: (status: 400 | 404 | 409, message: string) => never;
}

const PRIVACY_ORDER: PrivacyLevel[] = ["off", "standard", "strict"];

const AddBody = z.object({
  /** Entry name, e.g. "app.linear/linear". */
  name: z.string().min(3).max(200),
  /** Short name for the server and its account. Default: a free slug of the entry name. */
  id: Slug.optional(),
  prefer: z.enum(["remote", "package"]).optional(),
  /** Trust labels the user confirmed. Default: the entry's suggestion. */
  trust: z.array(TrustLevel).max(4).optional(),
  /** Values for the credential names the entry asks for. Stored in the vault only. */
  values: z.array(z.object({ name: z.string().min(1).max(200), value: z.string().max(10_000) })).default([]),
  clientId: z.string().min(1).max(500).optional(),
  clientSecret: z.string().min(1).max(10_000).optional(),
  clientIssuer: z.url().max(2000).optional(),
  /** Raise a profile's privacy level to this one. Never lowers it. */
  privacy: z.object({ profile: Slug.default(ALL_PROFILE), level: PrivacyLevel }).optional(),
});

/** A free server id: the slug, else slug-2, slug-3, ... */
function freeServerId(cfg: Config, base: string): string {
  const taken = (id: string) => !!cfg.servers[id] || !!cfg.accounts[id];
  if (!taken(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base.slice(0, 36)}-${i}`;
    if (!taken(id)) return id;
  }
}

/** The configured server that already runs this entry, matched by URL or command. */
function addedAs(cfg: Config, server: ServerDef): string | null {
  for (const [sid, s] of Object.entries(cfg.servers)) {
    if (s.transport !== "stdio" && server.transport !== "stdio" && s.url === server.url) return sid;
    if (
      s.transport === "stdio" &&
      server.transport === "stdio" &&
      s.command === server.command &&
      s.args.join("\0") === server.args.join("\0")
    )
      return sid;
  }
  return null;
}

/** One entry as the UI shows it: plain fields plus how it would be added. No values, names only. */
function entryView(cfg: Config, e: Entry) {
  const cur = curation(e);
  const base = freeServerId(cfg, entrySlug(e.name));
  const plan = entryToConfig(e, { serverId: base });
  const credentials = (() => {
    if (!plan.ok) return [];
    const c = plan.config;
    if (c.from.kind === "package")
      return c.needs.env.map((n) => {
        const v =
          c.from.kind === "package"
            ? c.from.package.environmentVariables.find((x) => x.name === n)
            : undefined;
        return {
          name: n,
          description: v?.description,
          required: v?.isRequired ?? false,
          secret: v?.isSecret ?? true,
        };
      });
    return c.needs.headers.map((n) => {
      const h = c.from.kind === "remote" ? c.from.remote.headers.find((x) => x.name === n) : undefined;
      return { name: n, description: h?.description, required: h?.isRequired ?? true, secret: true };
    });
  })();
  const icon = e.icons?.find((i) => !i.theme || i.theme === "light")?.src;
  return {
    name: e.name,
    title: e.title ?? e.name,
    description: e.description,
    version: e.version,
    websiteUrl: e.websiteUrl ?? null,
    repositoryUrl: e.repository?.url ?? null,
    icon: icon ?? null,
    tier: cur.tier,
    auth: { type: cur.auth.type, registration: cur.auth.registration ?? null },
    trust: cur.trust,
    privacy: cur.privacy,
    audience: cur.audience,
    categories: cur.categories,
    samplePrompt: cur.samplePrompt ?? null,
    reviewedAt: cur.reviewedAt,
    hasRemote: e.remotes.length > 0,
    hasPackage: e.packages.some((p) => p.registryType !== "mcpb"),
    ...(plan.ok
      ? {
          available: true as const,
          kind: plan.config.from.kind,
          target:
            plan.config.server.transport === "stdio"
              ? [plan.config.server.command, ...plan.config.server.args].join(" ")
              : plan.config.server.url,
          transport: plan.config.server.transport,
          serverId: base,
          credentials,
          addedAs: addedAs(cfg, plan.config.server),
        }
      : { available: false as const, reason: plan.reason, addedAs: null }),
  };
}

export function registerCatalogRoutes(api: Hono, handle: GatewayHandle, deps: CatalogDeps): void {
  const view = async (fetch: boolean) => {
    const cfg = handle.config();
    const v = fetch ? await handle.refreshCatalog() : await handle.catalog();
    return {
      enabled: cfg.catalog.enabled,
      source: v.source,
      fetchedAt: v.fetchedAt,
      serial: v.serial,
      ...(v.error ? { error: v.error } : {}),
      entries: v.entries.map((e) => entryView(cfg, e)),
      presets: v.presets,
    };
  };

  api.get("/catalog", async (c) => c.json(await view(false)));

  api.post("/catalog/refresh", async (c) => {
    if (!handle.config().catalog.enabled)
      deps.fail(400, "The catalog is turned off in config.yaml (catalog: { enabled: false }).");
    return c.json(await view(true));
  });

  api.post("/catalog/add", async (c) => {
    const b = AddBody.parse(await c.req.json());
    const entry = (await handle.catalog()).entries.find((e) => e.name === b.name);
    if (!entry) deps.fail(404, `"${b.name}" is not in the catalog.`);
    const cfg = handle.config();
    const sid = b.id ?? freeServerId(cfg, entrySlug(entry.name));
    const plan = entryToConfig(entry, { serverId: sid, prefer: b.prefer });
    if (!plan.ok) return deps.fail(400, plan.reason);
    const { server, needs } = plan.config;
    if (b.trust) server.trust = [...new Set(b.trust)];

    const names = new Set([...needs.env, ...needs.headers]);
    for (const v of b.values)
      if (!names.has(v.name)) deps.fail(400, `This server does not ask for "${v.name}".`);
    const given = b.values.filter((v) => v.value !== "");
    const creds = plan.config.from.kind === "package" ? plan.config.from.package.environmentVariables : [];
    for (const n of needs.env)
      if (creds.find((v) => v.name === n)?.isRequired && !given.some((v) => v.name === n))
        deps.fail(400, `Enter a value for ${n}.`);
    if (needs.headers.length && !given.length)
      deps.fail(400, `Enter a value for ${needs.headers.join(" or ")}.`);

    const accountAuth = plan.config.account.auth.type;
    const headers = needs.headers.length
      ? given
          .filter((v) => needs.headers.includes(v.name))
          .map((v) => ({
            name: v.name,
            // An Authorization header with a bare key gets "Bearer", as in the add-by-URL flow.
            value:
              v.name.toLowerCase() === "authorization" && !/^\w+\s/.test(v.value)
                ? `Bearer ${v.value}`
                : v.value,
          }))
      : [];
    const account = await deps.prepareAccount(
      sid,
      sid,
      undefined,
      {
        auth: accountAuth === "header" && headers.length === 0 ? "none" : accountAuth,
        headers,
        env: given.filter((v) => needs.env.includes(v.name)).map((v) => ({ ...v, secret: true })),
        ...(accountAuth === "oauth"
          ? { clientId: b.clientId, clientSecret: b.clientSecret, clientIssuer: b.clientIssuer }
          : {}),
      },
      server,
    );

    await handle.updateConfig((d) => {
      if (d.servers[sid]) deps.fail(409, `A server named "${sid}" already exists.`);
      if (d.accounts[account.id]) deps.fail(409, `An account named "${account.id}" already exists.`);
      d.servers[sid] = server;
      d.accounts[account.id] = account.def;
      if (b.privacy) {
        const pid = b.privacy.profile;
        const current = resolveProfile(d, pid);
        if (!current) deps.fail(404, `No profile named "${pid}".`);
        d.profiles[pid] ??= { ...current.def, accounts: [] };
        const p = d.profiles[pid];
        if (PRIVACY_ORDER.indexOf(b.privacy.level) > PRIVACY_ORDER.indexOf(p.privacy))
          p.privacy = b.privacy.level;
      }
    });
    const next = handle.config();
    return c.json(
      {
        server: {
          id: sid,
          name: server.name ?? sid,
          transport: server.transport,
          target: server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url,
          allowInsecure: server.allowInsecure,
          trust: server.trust,
          accounts: [account.id],
        },
        account: account.id,
        auth: account.def.auth.type,
        ...(b.privacy ? { privacy: resolveProfile(next, b.privacy.profile)?.def.privacy } : {}),
      },
      201,
    );
  });
}
