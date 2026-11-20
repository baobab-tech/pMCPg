// Gateway tokens in the vault: a client token per profile and the admin token for the CLI's local API.
// The front door and the admin API read the vault on every request, so a rotated token stops working at once.
import type { TokenRewrite } from "../onboarding/clients.ts";
import { APP_LABELS } from "../onboarding/importers.ts";
import type { EventSink } from "../store/events.ts";
import { type Vault, vaultKeys } from "../vault/vault.ts";

/** Random token, URL-safe. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Read or create a token in the vault. */
export async function ensureToken(vault: Vault, key: string): Promise<string> {
  const found = await vault.get(key);
  if (found) return found;
  const t = newToken();
  await vault.set(key, t);
  return t;
}

export type TokenTarget = { admin: true } | { profile: string };

export interface Rotation {
  /** The previous value, so app files holding it can be found. Never logged or shown. */
  old?: string;
  token: string;
}

/** Replace a token. The event names the target only. */
export async function rotateToken(
  vault: Vault,
  target: TokenTarget,
  events: EventSink | undefined,
  via: "cli" | "ui",
): Promise<Rotation> {
  const key = "admin" in target ? vaultKeys.adminToken() : vaultKeys.clientToken(target.profile);
  const old = await vault.get(key);
  const token = newToken();
  await vault.set(key, token);
  events?.emit(
    "admin" in target
      ? { type: "token-rotated", token: "admin", via }
      : { type: "token-rotated", token: "client", profileId: target.profile, via },
  );
  return { ...(old ? { old } : {}), token };
}

/** Plain-language lines after a rotation: what keeps working and which apps need the user. No token values. */
export function rotationNotes(target: TokenTarget, rewrites: TokenRewrite[] = []): string[] {
  if ("admin" in target)
    return [
      "The old admin token no longer works. The pmcpg command reads the new one itself; nothing to reconnect.",
    ];
  const p = target.profile;
  const lines = [
    `The old token of profile "${p}" no longer works.`,
    "Apps connected with the stdio bridge (`pmcpg connect`) read the new token on their next request; nothing to do.",
  ];
  for (const r of rewrites) {
    const label = APP_LABELS[r.app];
    if (r.error)
      lines.push(
        `${label}: could not update ${r.file} (${r.error}). Reconnect it: pmcpg connect-app ${r.app} --profile ${p}`,
      );
    else
      lines.push(
        `${label}: new token written to ${r.file} (${r.entries.join(", ")})${r.backup ? `; backup ${r.backup}` : ""}. Restart ${label} if its tools stop working.`,
      );
  }
  lines.push(
    `Any other app or script you gave this token to by hand needs the new one (\`pmcpg profile token ${p}\`).`,
  );
  return lines;
}
