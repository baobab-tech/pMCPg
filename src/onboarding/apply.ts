// Turn selected import candidates into servers, accounts and (optionally) profiles in config.yaml.
// Secret values are never copied: env and header entries point at empty vault keys the user fills in.
import { basename } from "node:path";
import type { AccountDef, Config, ServerDef } from "../core/config.ts";
import type { GatewayHandle } from "../gateway/handle.ts";
import { vaultKeys } from "../vault/vault.ts";
import type { Candidate } from "./importers.ts";
import { ARG_SECRET_MARKER, isThisGateway, keyOf } from "./importers.ts";
import { type ProbeResult, probeServer, uniqueId } from "./probe.ts";

export interface ImportOptions {
  /** Create a profile per Claude Code project, holding that project's servers. */
  profilePerProject?: boolean;
  probe?: (url: string, allowInsecure: boolean) => Promise<ProbeResult>;
}

export interface ImportOutcome {
  key: string;
  /** "skipped-secret": a key is part of the URL itself; add the server by hand. */
  status: "added" | "already-added" | "skipped-self" | "skipped-secret";
  accountId?: string;
  /** What the user still has to do: sign in, or fill in values for these env/header names. */
  needsSignIn?: boolean;
  missingValues?: string[];
  /** The remote server could not be probed; added with no sign-in, to check later. */
  probeError?: string;
}

/** Same fragment rule as the UI API, so both write the same vault keys. */
function keyPart(name: string): string {
  return name.toLowerCase().replace(/[^\w.-]+/g, "-");
}
export const headerVaultKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `header-${keyPart(name)}`);
export const envVaultKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `env-${keyPart(name)}`);
export const paramVaultKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `param-${keyPart(name)}`);

function isLocalUrl(url: string): boolean {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

/**
 * Probe; if an old `…/sse` address no longer answers, try `…/mcp` on the same host.
 * Many providers (e.g. Linear) moved from HTTP+SSE to Streamable HTTP at /mcp.
 */
export async function probeWithSseFallback(
  url: string,
  probe: (url: string, allowInsecure: boolean) => Promise<ProbeResult>,
): Promise<ProbeResult> {
  const first = await probe(url, isLocalUrl(url));
  if (first.ok || !/\/sse\/?$/.test(new URL(url).pathname)) return first;
  const moved = new URL(url);
  moved.pathname = moved.pathname.replace(/\/sse\/?$/, "/mcp");
  const second = await probe(moved.toString(), isLocalUrl(url));
  return second.ok ? second : first;
}

function existingKeys(cfg: Config): Set<string> {
  return new Set(
    Object.values(cfg.servers).map((s) =>
      keyOf(
        s.transport === "stdio"
          ? { transport: "stdio", command: s.command, args: s.args }
          : { transport: s.transport, url: s.url },
      ),
    ),
  );
}

export async function applyImport(
  handle: Pick<GatewayHandle, "config" | "updateConfig" | "vault">,
  candidates: Candidate[],
  opts: ImportOptions = {},
): Promise<ImportOutcome[]> {
  const probe = opts.probe ?? ((url, allowInsecure) => probeServer(url, { allowInsecure }));
  const cfg = handle.config();
  const have = existingKeys(cfg);
  const taken = new Set([...Object.keys(cfg.servers), ...Object.keys(cfg.accounts), "all"]);
  const outcomes: ImportOutcome[] = [];
  const servers: Record<string, ServerDef> = {};
  const accounts: Record<string, AccountDef> = {};
  const projectAccounts = new Map<string, string[]>();

  const probes = await Promise.all(
    candidates.map((c) =>
      c.server.transport === "stdio" || have.has(c.key)
        ? undefined
        : probeWithSseFallback(c.server.url, probe),
    ),
  );

  candidates.forEach((c, i) => {
    if (isThisGateway(c.server, cfg.gateway.port)) {
      outcomes.push({ key: c.key, status: "skipped-self" });
      return;
    }
    if (have.has(c.key)) {
      outcomes.push({ key: c.key, status: "already-added" });
      return;
    }
    if (c.secretInUrl) {
      outcomes.push({ key: c.key, status: "skipped-secret" });
      return;
    }
    const id = uniqueId(c.suggestedId, taken);
    const missing: string[] = [];
    let needsSignIn = false;
    let probeError: string | undefined;

    if (c.server.transport === "stdio") {
      servers[id] = {
        transport: "stdio",
        command: c.server.command,
        // Secrets removed from arguments come back from the vault at spawn time.
        args: c.server.args.map((a) =>
          a.replace(ARG_SECRET_MARKER, (_, name: string) => `{{vault:${envVaultKey(id, name)}}}`),
        ),
        env: {},
        trust: [],
        allowInsecure: false,
      };
      const env = Object.fromEntries(c.envNames.map((n) => [n, `vault:${envVaultKey(id, n)}`]));
      accounts[id] = { server: id, auth: { type: "none" }, env };
      missing.push(...c.envNames);
    } else {
      const p = probes[i];
      // The probe may have found the server at a newer address (e.g. /sse moved to /mcp).
      const url = p?.ok ? p.url : c.server.url;
      const transport = p?.ok ? p.transport : c.server.transport;
      servers[id] = { transport, url, trust: [], allowInsecure: isLocalUrl(url) };
      let auth: AccountDef["auth"] = { type: "none" };
      if (p?.ok && p.auth.type === "oauth") {
        auth = { type: "oauth", ...(p.auth.scopes ? { scopes: p.auth.scopes } : {}) };
        needsSignIn = true;
      } else if ((p?.ok && p.auth.type === "header") || c.headerNames.length) {
        const names = c.headerNames.length ? c.headerNames : ["Authorization"];
        auth = {
          type: "header",
          headers: Object.fromEntries(names.map((n) => [n, `{{vault:${headerVaultKey(id, n)}}}`])),
        };
        missing.push(...names);
      }
      if (p && !p.ok) probeError = p.error;
      // Secret query parameters were removed from the URL; they come back as vault-backed URL parameters.
      missing.push(...c.secretParams.map((n) => `?${n}`));
      const urlParams = Object.fromEntries(c.secretParams.map((n) => [n, `vault:${paramVaultKey(id, n)}`]));
      accounts[id] = { server: id, auth, env: {}, ...(c.secretParams.length ? { urlParams } : {}) };
    }

    for (const f of c.foundIn)
      if (f.project) projectAccounts.set(f.project, [...(projectAccounts.get(f.project) ?? []), id]);
    outcomes.push({
      key: c.key,
      status: "added",
      accountId: id,
      ...(needsSignIn ? { needsSignIn } : {}),
      ...(missing.length ? { missingValues: missing } : {}),
      ...(probeError ? { probeError } : {}),
    });
  });

  if (!Object.keys(servers).length) return outcomes;
  await handle.updateConfig((draft) => {
    Object.assign(draft.servers, servers);
    Object.assign(draft.accounts, accounts);
    if (opts.profilePerProject) {
      for (const [project, ids] of projectAccounts) {
        const base =
          basename(project)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "project";
        const pid = draft.profiles[base]
          ? base
          : uniqueId(base, new Set([...Object.keys(draft.profiles), "all"]));
        const existing = draft.profiles[pid];
        draft.profiles[pid] = {
          ...(existing ?? { privacy: "standard", readOnly: false, deny: [] }),
          name: existing?.name ?? basename(project),
          accounts: [...new Set([...(existing?.accounts ?? []), ...ids])],
        } as Config["profiles"][string];
      }
    }
  });
  return outcomes;
}
