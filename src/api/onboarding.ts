// Onboarding endpoints under /api/ui: probe a URL, import from AI apps, connect AI apps.
// Registered by createUiApi, so they sit behind the same session, CSRF and Host/Origin checks.
import type { Hono } from "hono";
import { z } from "zod";
import { Slug } from "../core/config.ts";
import type { GatewayHandle } from "../gateway/handle.ts";
import { applyImport } from "../onboarding/apply.ts";
import { applyConnect, type ConnectApp, planConnect, selfCommand } from "../onboarding/clients.ts";
import {
  APP_LABELS,
  type AppId,
  appStatus,
  type Candidate,
  defaultScanEnv,
  isThisGateway,
  keyOf,
  mergeFound,
  type ScanEnv,
  scanApps,
} from "../onboarding/importers.ts";
import {
  MAX_PASTE_CHARS,
  MAX_PASTE_ENTRIES,
  PASTE_PROMPT,
  parsePasted,
  pastedCandidate,
} from "../onboarding/paste.ts";
import { probeServer } from "../onboarding/probe.ts";
import { clientAddress, type UiAuth } from "./auth.ts";

export interface OnboardingOptions {
  /** Where to look for AI apps' files. Tests pass a fake home. */
  scanEnv?: () => ScanEnv;
  /** Command that starts pmcpg, written into Claude Desktop's config. */
  pmcpgCommand?: () => string[];
}

const CONNECT_APPS = ["claude-desktop", "claude-code", "lm-studio", "cursor", "vscode"] as const;
const AppParam = z.enum(CONNECT_APPS);

const ProbeBody = z.object({ url: z.string().min(1).max(2000) });
const ImportBody = z.object({
  keys: z.array(z.string().max(4000)).min(1).max(200),
  profilePerProject: z.boolean().default(false),
});
// Over-long pastes are cut to MAX_PASTE_CHARS by the parser and flagged; this only bounds the request.
const PasteBody = z.object({ text: z.string().max(MAX_PASTE_CHARS * 2) });
const PasteApplyBody = z.object({
  servers: z
    .array(
      z.object({
        name: z.string().max(200),
        url: z.string().max(2000),
        secretParams: z
          .array(z.string().regex(/^[\w.-]{1,64}$/))
          .max(20)
          .default([]),
      }),
    )
    .min(1)
    .max(MAX_PASTE_ENTRIES),
});
const ConnectBody = z.object({
  profile: Slug.default("all"),
  remove: z.array(z.string().max(200)).max(200).default([]),
  password: z.string().optional(),
});

function serverKeys(handle: GatewayHandle): Set<string> {
  return new Set(
    Object.values(handle.config().servers).map((s) =>
      keyOf(
        s.transport === "stdio"
          ? { transport: "stdio", command: s.command, args: s.args }
          : { transport: s.transport, url: s.url },
      ),
    ),
  );
}

export function registerOnboardingRoutes(
  api: Hono,
  handle: GatewayHandle,
  auth: UiAuth,
  opts: OnboardingOptions = {},
) {
  const env = opts.scanEnv ?? defaultScanEnv;
  const pmcpg = opts.pmcpgCommand ?? selfCommand;
  const port = () => handle.config().gateway.port;

  const scan = (): Candidate[] => mergeFound(scanApps(env())).filter((c) => !isThisGateway(c.server, port()));

  api.post("/probe", async (c) => {
    const { url } = ProbeBody.parse(await c.req.json());
    let local = false;
    try {
      const h = new URL(url).hostname;
      local = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    } catch {
      // probeServer reports the bad URL
    }
    return c.json(await probeServer(url, { allowInsecure: local }));
  });

  api.get("/import/scan", (c) => {
    const have = serverKeys(handle);
    const candidates = scan().map((cand) => ({
      ...cand,
      alreadyAdded: have.has(cand.key),
      foundIn: cand.foundIn.map((f) => ({ ...f, appLabel: APP_LABELS[f.app] })),
    }));
    const apps = Object.keys(APP_LABELS).map((id) => ({
      id,
      label: APP_LABELS[id as AppId],
      servers: candidates.filter((cand) => cand.foundIn.some((f) => f.app === id)).length,
    }));
    return c.json({
      apps,
      candidates,
      note: "Servers you added in claude.ai, ChatGPT or Gemini live in those companies' clouds and cannot be read from this computer.",
    });
  });

  api.post("/import/apply", async (c) => {
    const { keys, profilePerProject } = ImportBody.parse(await c.req.json());
    // Re-scan on the server: the client only picks keys, it never supplies commands or URLs.
    const wanted = new Set(keys);
    const picked = scan().filter((cand) => wanted.has(cand.key));
    return c.json({ outcomes: await applyImport(handle, picked, { profilePerProject }) });
  });

  // Cloud connectors (claude.ai, ChatGPT): the user pastes the chatbot's own list. Parsing never fetches.
  api.get("/import/paste", (c) => c.json({ prompt: PASTE_PROMPT }));

  api.post("/import/paste", async (c) => {
    const { text } = PasteBody.parse(await c.req.json());
    const have = serverKeys(handle);
    const r = parsePasted(text);
    return c.json({
      truncated: r.truncated,
      servers: r.servers.map((s) => ({ ...s, alreadyAdded: !!s.key && have.has(s.key) })),
    });
  });

  api.post("/import/paste/apply", async (c) => {
    const { servers } = PasteApplyBody.parse(await c.req.json());
    // The client sends the URLs here, so each one is checked again before anything is probed.
    const picked = servers.map((s) => ({ s, cand: pastedCandidate(s.name, s.url, s.secretParams) }));
    const bad = picked.find((p) => "error" in p.cand);
    if (bad && "error" in bad.cand) return c.json({ error: `${bad.s.name}: ${bad.cand.error}` }, 400);
    const byKey = new Map<string, Candidate>();
    for (const p of picked) if (!("error" in p.cand) && !byKey.has(p.cand.key)) byKey.set(p.cand.key, p.cand);
    return c.json({ outcomes: await applyImport(handle, [...byKey.values()]) });
  });

  /** Entries in an app that the gateway now provides: suggested for removal from that app. */
  const suggestRemove = (app: ConnectApp): string[] => {
    const have = serverKeys(handle);
    return scanApps(env())
      .filter((f) => f.app === app && !f.project && !f.extension && have.has(keyOf(f.server)))
      .map((f) => f.name);
  };

  /** Which AI apps are installed and which already point at this gateway. Names and booleans only. */
  api.get("/connect/status", (c) => c.json(appStatus(env(), port())));

  api.get("/connect/:app/plan", async (c) => {
    const app = AppParam.parse(c.req.param("app"));
    const profile = Slug.parse(c.req.query("profile") ?? "all");
    const remove = c.req.query("remove")?.split(",").filter(Boolean) ?? suggestRemove(app);
    const plan = planConnect(
      app,
      { profile, gatewayUrl: handle.url, token: await handle.clientToken(profile), pmcpg: pmcpg(), remove },
      env(),
    );
    return c.json({ ...plan, suggestedRemove: suggestRemove(app) });
  });

  api.post("/connect/:app", async (c) => {
    const app = AppParam.parse(c.req.param("app"));
    const b = ConnectBody.parse(await c.req.json());
    // Changes another app's files: confirm with the UI password when one is set.
    await auth.confirm(b.password, clientAddress(c));
    const result = await applyConnect(
      app,
      {
        profile: b.profile,
        gatewayUrl: handle.url,
        token: await handle.clientToken(b.profile),
        pmcpg: pmcpg(),
        remove: b.remove,
      },
      env(),
    );
    return c.json(result);
  });
}
