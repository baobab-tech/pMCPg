// `pmcpg token rotate`: replace a profile's client token or the admin token (VLT-3). Registered in commands.ts.
// Works whether or not the gateway runs: it reads tokens from the vault on every request.
import { Slug } from "../core/config.ts";
import { resolveProfile } from "../core/profiles.ts";
import { openState } from "../gateway/runtime.ts";
import { rotateToken, rotationNotes, type TokenTarget } from "../gateway/tokens.ts";
import { rewriteAppTokens } from "../onboarding/clients.ts";
import { defaultScanEnv, type ScanEnv } from "../onboarding/importers.ts";
import { SqliteActivityLog } from "../store/activity-log.ts";
import { getDataKey } from "../vault/select.ts";
import { type Command, EXIT_OK, EXIT_USAGE, type Io, type Parsed } from "./cli.ts";

/** The command body. `env` says where AI apps' files are (tests pass a fake home). */
export async function tokenRotate(p: Parsed, io: Io, env: ScanEnv = defaultScanEnv()): Promise<number> {
  const profile = typeof p.values.profile === "string" ? p.values.profile : undefined;
  const admin = p.values.admin === true;
  if (admin === (profile !== undefined)) {
    io.err("Choose one: --profile <name> or --admin.");
    return EXIT_USAGE;
  }
  if (profile !== undefined && !Slug.safeParse(profile).success) {
    io.err(`Invalid profile name "${profile}".`);
    return EXIT_USAGE;
  }
  const { config, vault, db } = await openState();
  try {
    if (profile !== undefined && !resolveProfile(config, profile)) {
      io.err(`No profile named "${profile}".`);
      return EXIT_USAGE;
    }
    const target: TokenTarget = profile !== undefined ? { profile } : { admin: true };
    const activity = new SqliteActivityLog(db, await getDataKey(vault));
    const r = await rotateToken(vault, target, activity, "cli");
    await activity.flush();
    const rewrites = profile !== undefined && r.old ? rewriteAppTokens(r.old, r.token, env) : [];
    for (const line of rotationNotes(target, rewrites)) io.out(line);
    return EXIT_OK;
  } finally {
    db.close();
  }
}

export const tokenCommands: Command[] = [
  {
    path: ["token", "rotate"],
    summary: "Replace a profile's client token or the admin token; the old one stops working at once",
    args: "--profile <name> | --admin",
    options: { profile: { type: "string" }, admin: { type: "boolean" } },
    optionHelp: {
      profile: "Profile whose client token to replace",
      admin: "Replace the admin token the pmcpg command uses",
    },
    maxArgs: 0,
    run: (p, io) => tokenRotate(p, io),
  },
];
