// Map a catalog entry to config.yaml objects. Pure: no I/O, no secrets. Credentials become vault
// references the user fills in, with the same key names the import flow uses.
import type { AccountDef, ServerDef } from "../core/config.ts";
import { envVaultKey, headerVaultKey } from "../onboarding/apply.ts";
import { curation, type Entry, type PackageDef, type RemoteDef } from "./schema.ts";

export interface EntryConfig {
  serverId: string;
  server: ServerDef;
  accountId: string;
  account: AccountDef;
  /** Env and header names the user must give a value for (stored under the account in the vault). */
  needs: { env: string[]; headers: string[] };
  /** Which part of the entry was used. */
  from: { kind: "remote"; remote: RemoteDef } | { kind: "package"; package: PackageDef };
}

export type EntryConfigResult = { ok: true; config: EntryConfig } | { ok: false; reason: string };

export interface EntryConfigOptions {
  /** Defaults to a slug of the entry name. */
  serverId?: string;
  /** Defaults to serverId. */
  accountId?: string;
  /** Which to use when an entry has both. Default "remote". */
  prefer?: "remote" | "package";
}

/** "io.github.acme/Grants-Search" -> "grants-search". Always a valid Slug. */
export function entrySlug(name: string): string {
  const last = name.slice(name.lastIndexOf("/") + 1);
  const s = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "server";
}

function packageCommand(p: PackageDef): { command: string; args: string[] } | undefined {
  const extra = p.packageArguments.flatMap((a) =>
    a.type === "positional" ? [a.value] : a.value === undefined ? [a.name] : [a.name, a.value],
  );
  switch (p.registryType) {
    case "npm":
      return { command: "npx", args: ["-y", `${p.identifier}@${p.version}`, ...extra] };
    case "pypi":
      return { command: "uvx", args: [`${p.identifier}==${p.version}`, ...extra] };
    case "oci":
      return {
        command: "docker",
        args: [
          "run",
          "-i",
          "--rm",
          ...p.environmentVariables.flatMap((v) => ["-e", v.name]),
          `${p.identifier}:${p.version}`,
          ...extra,
        ],
      };
    case "mcpb":
      return undefined;
  }
}

export function entryToConfig(entry: Entry, opts: EntryConfigOptions = {}): EntryConfigResult {
  const cur = curation(entry);
  const serverId = opts.serverId ?? entrySlug(entry.name);
  const accountId = opts.accountId ?? serverId;
  const remote = entry.remotes[0];
  const pkg = entry.packages.find((p) => p.registryType !== "mcpb");
  const useRemote = remote && (opts.prefer !== "package" || !pkg);
  const base = { name: entry.title ?? entry.name, trust: [...cur.trust], allowInsecure: false };

  if (useRemote) {
    const headerNames =
      cur.auth.type === "header"
        ? cur.auth.credentials.length
          ? cur.auth.credentials
          : remote.headers.filter((h) => h.isSecret || h.isRequired).map((h) => h.name)
        : [];
    const auth: AccountDef["auth"] =
      cur.auth.type === "oauth"
        ? { type: "oauth" }
        : cur.auth.type === "header"
          ? {
              type: "header",
              headers: Object.fromEntries(
                headerNames.map((n) => [n, `{{vault:${headerVaultKey(accountId, n)}}}`]),
              ),
            }
          : { type: "none" };
    return {
      ok: true,
      config: {
        serverId,
        server: { transport: remote.type === "sse" ? "sse" : "http", url: remote.url, ...base },
        accountId,
        account: { server: serverId, auth, env: {} },
        needs: { env: [], headers: headerNames },
        from: { kind: "remote", remote },
      },
    };
  }

  if (!pkg)
    return entry.packages.length
      ? { ok: false, reason: "This server ships as an mcpb bundle, which needs the bundle installer." }
      : { ok: false, reason: "This entry has no package or remote server." };
  const cmd = packageCommand(pkg);
  if (!cmd) return { ok: false, reason: "This package type cannot be run directly." };

  // Non-secret defaults are plain config; every other variable is a per-account vault value.
  const serverEnv: Record<string, string> = {};
  const accountEnv: Record<string, string> = {};
  const needEnv: string[] = [];
  for (const v of pkg.environmentVariables) {
    if (!v.isSecret && v.default !== undefined) serverEnv[v.name] = v.default;
    else if (v.isSecret || v.isRequired) {
      accountEnv[v.name] = `vault:${envVaultKey(accountId, v.name)}`;
      needEnv.push(v.name);
    }
  }
  return {
    ok: true,
    config: {
      serverId,
      server: { transport: "stdio", command: cmd.command, args: cmd.args, env: serverEnv, ...base },
      accountId,
      account: { server: serverId, auth: { type: "none" }, env: accountEnv },
      needs: { env: needEnv, headers: [] },
      from: { kind: "package", package: pkg },
    },
  };
}
