// Server skills on state.db (tables skill_pins, skill_pin_accounts, skill_quarantine, skill_files).
// Trust on first use: the first sync after an account's skills are turned on pins every listed skill.
// After that a new or changed skill is held for review; the approved version, if any, stays served.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { Connector, DownstreamSkill } from "../connectors/connector.ts";
import { asText, digestOf, frontmatter, isTextFile, SKILL_LIMITS, sortFiles, validPath } from "./files.ts";
import { buildEntry } from "./library.ts";
import type { ServerSkill, SkillFileInfo, SkillFileInput, SkillReview } from "./skills.ts";

export type SkillMode = "text" | "all";

/** What pins and quarantine rows keep of a skill entry: no URIs, only relative files. */
interface StoredEntry {
  name: string;
  description: string;
  files: SkillFileInfo[];
}

interface PinRow {
  skill_path: string;
  hash: string;
  entry: string;
  skill_md: string;
}
interface QuarantineRow extends PinRow {
  status: "pending" | "rejected";
}

export interface SyncResult {
  added: number;
  removed: number;
  changed: number;
  held: number;
  /** Skills skipped, with the reason. No contents. */
  skipped: string[];
}

/** A server skill version clients may get: the approved one. */
export interface ServableSkill {
  accountId: string;
  path: string;
  name: string;
  description: string;
  files: SkillFileInput[];
}

/** Path of a listed skill under its server's skill:// root, from its SKILL.md URI. */
export function skillPathOf(uri: string): string | undefined {
  const m = /^skill:\/\/(.+)\/SKILL\.md$/.exec(uri);
  if (!m?.[1]) return undefined;
  try {
    const path = m[1].split("/").map(decodeURIComponent).join("/");
    return validPath(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Relative file paths of an entry, keyed by URI. Undefined when a URI is outside the skill. */
function relativeFiles(skill: DownstreamSkill, path: string): Map<string, SkillFileInfo> | undefined {
  if (skill.resources === "dynamic") return undefined;
  const out = new Map<string, SkillFileInfo>();
  for (const r of skill.resources) {
    let rel: string;
    try {
      const decoded = r.uri
        .replace(/^skill:\/\//, "")
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      if (!decoded.startsWith(`${path}/`)) return undefined;
      rel = decoded.slice(path.length + 1);
    } catch {
      return undefined;
    }
    if (!validPath(rel)) return undefined;
    out.set(r.uri, { path: rel, size: r.size, digest: r.digest });
  }
  return out;
}

/** SHA-256 over the sorted (path, digest, size) lines: any file added, removed or changed changes it. */
export function resourceHash(files: SkillFileInfo[]): string {
  const lines = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}\t${f.digest}\t${f.size}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

const wanted = (mode: SkillMode, path: string) => path === "SKILL.md" || mode === "all" || isTextFile(path);

export class ServerSkillStore {
  constructor(private readonly db: Database) {}

  /** List the account's skills, fetch and verify the files `mode` keeps, then pin or hold. */
  async sync(
    accountId: string,
    connector: Connector,
    mode: SkillMode,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const result: SyncResult = { added: 0, removed: 0, changed: 0, held: 0, skipped: [] };
    const listed = connector.listSkills ? await connector.listSkills(signal) : [];
    const firstSync = !this.db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM skill_pin_accounts WHERE account_id = ?")
      .get(accountId)?.n;
    const pins = new Map(this.pinRows(accountId).map((r) => [r.skill_path, r]));
    const held = new Map(this.quarantineRows(accountId).map((r) => [r.skill_path, r]));
    const seen = new Set<string>();
    const now = Date.now();

    for (const skill of listed) {
      const path = skillPathOf(skill.uri);
      if (!path) {
        result.skipped.push(`${skill.uri.slice(0, 200)}: not a skill:// SKILL.md URI`);
        continue;
      }
      if (seen.has(path)) continue;
      const files = relativeFiles(skill, path);
      if (!files) {
        result.skipped.push(`${path}: generated ("dynamic") or malformed file list; cannot be pinned`);
        continue;
      }
      const all = [...files.values()];
      const bytes = all.reduce((n, f) => n + f.size, 0);
      if (all.length > SKILL_LIMITS.files || bytes > SKILL_LIMITS.bytes) {
        result.skipped.push(`${path}: over the limits (${all.length} files, ${bytes} bytes)`);
        continue;
      }
      const hash = resourceHash(all);
      const pin = pins.get(path);
      const hold = held.get(path);
      // Fetch what this version needs, unless already stored.
      let skillMd: string;
      try {
        skillMd = await this.fetch(accountId, path, hash, skill, files, mode, connector, signal);
        await buildEntry(
          `accounts/${accountId}/${path}`,
          path.split("/").pop() ?? path,
          this.filesFor(accountId, path, hash, mode),
        );
      } catch (e) {
        result.skipped.push(`${path}: ${(e as Error).message.split("\n")[0]?.slice(0, 300)}`);
        continue;
      }
      seen.add(path);
      const fm = frontmatter(skillMd);
      const stored: StoredEntry = {
        name: fm?.name ?? path.split("/").pop() ?? path,
        description: fm?.description ?? "",
        files: sortFiles(all),
      };
      const entryJson = JSON.stringify(stored);
      if (pin?.hash === hash) {
        if (hold)
          this.db.run("DELETE FROM skill_quarantine WHERE account_id = ? AND skill_path = ?", [
            accountId,
            path,
          ]);
        continue;
      }
      if (!pin && firstSync) {
        this.db.run(
          "INSERT OR REPLACE INTO skill_pins (account_id, skill_path, hash, entry, skill_md, approved_at) VALUES (?, ?, ?, ?, ?, ?)",
          [accountId, path, hash, entryJson, skillMd, now],
        );
        result.added++;
        continue;
      }
      if (hold?.hash === hash) {
        if (hold.status === "pending") result.held++;
        continue;
      }
      this.db.run(
        `INSERT OR REPLACE INTO skill_quarantine (account_id, skill_path, hash, entry, skill_md, status, seen_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [accountId, path, hash, entryJson, skillMd, now],
      );
      result.held++;
      if (pin) result.changed++;
      else result.added++;
    }

    // Skills the server no longer lists: forget them, so a comeback is reviewed as new.
    for (const path of new Set([...pins.keys(), ...held.keys()])) {
      if (seen.has(path)) continue;
      this.db.run("DELETE FROM skill_pins WHERE account_id = ? AND skill_path = ?", [accountId, path]);
      this.db.run("DELETE FROM skill_quarantine WHERE account_id = ? AND skill_path = ?", [accountId, path]);
      if (pins.has(path)) result.removed++;
    }
    if (firstSync)
      this.db.run("INSERT OR IGNORE INTO skill_pin_accounts (account_id, pinned_at) VALUES (?, ?)", [
        accountId,
        now,
      ]);
    this.collectGarbage(accountId);
    return result;
  }

  /** Store the files `mode` keeps for one version; returns its SKILL.md text. Verifies size and digest. */
  private async fetch(
    accountId: string,
    path: string,
    hash: string,
    skill: DownstreamSkill,
    files: Map<string, SkillFileInfo>,
    mode: SkillMode,
    connector: Connector,
    signal?: AbortSignal,
  ): Promise<string> {
    const have = new Set(
      this.db
        .query<{ path: string }, [string, string, string]>(
          "SELECT path FROM skill_files WHERE account_id = ? AND skill_path = ? AND hash = ?",
        )
        .all(accountId, path, hash)
        .map((r) => r.path),
    );
    if (![...files.values()].some((f) => f.path === "SKILL.md"))
      throw new Error("no SKILL.md in its file list");
    for (const [uri, f] of files) {
      if (!wanted(mode, f.path) || have.has(f.path)) continue;
      if (!connector.readSkillFile) throw new Error("the connector cannot read skill files");
      const bytes = await connector.readSkillFile(skill, uri, signal);
      if (bytes.byteLength !== f.size || digestOf(bytes) !== f.digest)
        throw new Error(`${f.path}: size or digest mismatch`);
      this.db.run(
        "INSERT OR REPLACE INTO skill_files (account_id, skill_path, hash, path, digest, content) VALUES (?, ?, ?, ?, ?, ?)",
        [accountId, path, hash, f.path, f.digest, bytes],
      );
    }
    const md = this.file(accountId, path, hash, "SKILL.md");
    const text = md && asText(md);
    if (text === undefined || text === "") throw new Error("SKILL.md is not UTF-8 text");
    return text;
  }

  private file(accountId: string, path: string, hash: string, rel: string): Uint8Array | undefined {
    const row = this.db
      .query<{ content: Uint8Array }, [string, string, string, string]>(
        "SELECT content FROM skill_files WHERE account_id = ? AND skill_path = ? AND hash = ? AND path = ?",
      )
      .get(accountId, path, hash, rel);
    return row ? new Uint8Array(row.content) : undefined;
  }

  /** Stored files of one version that `mode` serves, with their digests checked again. */
  private filesFor(accountId: string, path: string, hash: string, mode: SkillMode): SkillFileInput[] {
    return this.db
      .query<{ path: string; digest: string; content: Uint8Array }, [string, string, string]>(
        "SELECT path, digest, content FROM skill_files WHERE account_id = ? AND skill_path = ? AND hash = ? ORDER BY path",
      )
      .all(accountId, path, hash)
      .filter((r) => wanted(mode, r.path))
      .map((r) => ({ path: r.path, digest: r.digest, content: new Uint8Array(r.content) }))
      .filter((r) => digestOf(r.content) === r.digest)
      .map(({ path: p, content }) => ({ path: p, content }));
  }

  /** Approved versions of the account's skills, as `mode` serves them. */
  servable(accountId: string, mode: SkillMode): ServableSkill[] {
    const out: ServableSkill[] = [];
    for (const pin of this.pinRows(accountId)) {
      const files = this.filesFor(accountId, pin.skill_path, pin.hash, mode);
      if (!files.some((f) => f.path === "SKILL.md")) continue;
      const e = JSON.parse(pin.entry) as StoredEntry;
      out.push({
        accountId,
        path: pin.skill_path,
        name: e.name,
        description: e.description,
        files: sortFiles(files),
      });
    }
    return out;
  }

  list(accountId: string, mode: SkillMode): ServerSkill[] {
    const pins = new Map(this.pinRows(accountId).map((r) => [r.skill_path, r]));
    const held = new Map(this.quarantineRows(accountId).map((r) => [r.skill_path, r]));
    const served = new Set(this.servable(accountId, mode).map((s) => s.path));
    return [...new Set([...pins.keys(), ...held.keys()])].sort().map((path) => {
      const q = held.get(path);
      // Name and description of the version clients get: the approved one when there is one.
      const e = JSON.parse((pins.get(path) ?? q)?.entry ?? "{}") as StoredEntry;
      return {
        accountId,
        path,
        id: `${accountId}/${path}`,
        name: e.name,
        description: e.description,
        status: q ? (q.status === "pending" ? "held" : "rejected") : "active",
        served: served.has(path),
        files: e.files.filter((f) => wanted(mode, f.path)),
      };
    });
  }

  reviews(accountId?: string): SkillReview[] {
    const rows = this.db
      .query<QuarantineRow & { account_id: string }, []>(
        "SELECT account_id, skill_path, hash, entry, skill_md, status FROM skill_quarantine ORDER BY account_id, skill_path",
      )
      .all()
      .filter((r) => accountId === undefined || r.account_id === accountId);
    return rows.map((r) => {
      const pin = this.pinRows(r.account_id).find((p) => p.skill_path === r.skill_path);
      const current = JSON.parse(r.entry) as StoredEntry;
      return {
        accountId: r.account_id,
        path: r.skill_path,
        reason: pin ? "changed" : "new",
        status: r.status,
        currentSkillMd: r.skill_md,
        currentFiles: current.files,
        ...(pin
          ? { pinnedSkillMd: pin.skill_md, pinnedFiles: (JSON.parse(pin.entry) as StoredEntry).files }
          : {}),
      };
    });
  }

  approve(accountId: string, path: string): boolean {
    const q = this.quarantineRows(accountId).find((r) => r.skill_path === path);
    if (!q) return false;
    this.db.transaction(() => {
      this.db.run(
        "INSERT OR REPLACE INTO skill_pins (account_id, skill_path, hash, entry, skill_md, approved_at) VALUES (?, ?, ?, ?, ?, ?)",
        [accountId, path, q.hash, q.entry, q.skill_md, Date.now()],
      );
      this.db.run("DELETE FROM skill_quarantine WHERE account_id = ? AND skill_path = ?", [accountId, path]);
    })();
    this.collectGarbage(accountId);
    return true;
  }

  reject(accountId: string, path: string): boolean {
    const r = this.db.run(
      "UPDATE skill_quarantine SET status = 'rejected' WHERE account_id = ? AND skill_path = ?",
      [accountId, path],
    );
    return r.changes > 0;
  }

  /** Drop every pin, review and file of an account (skills turned off, or the account removed). */
  forget(accountId: string): void {
    this.db.transaction(() => {
      for (const t of ["skill_pins", "skill_pin_accounts", "skill_quarantine", "skill_files"])
        this.db.run(`DELETE FROM ${t} WHERE account_id = ?`, [accountId]);
    })();
  }

  /** Accounts with any stored skill state. */
  accounts(): string[] {
    return this.db
      .query<{ account_id: string }, []>(
        `SELECT account_id FROM skill_pin_accounts UNION SELECT account_id FROM skill_pins
         UNION SELECT account_id FROM skill_quarantine UNION SELECT account_id FROM skill_files`,
      )
      .all()
      .map((r) => r.account_id);
  }

  private pinRows(accountId: string): PinRow[] {
    return this.db
      .query<PinRow, [string]>(
        "SELECT skill_path, hash, entry, skill_md FROM skill_pins WHERE account_id = ? ORDER BY skill_path",
      )
      .all(accountId);
  }

  private quarantineRows(accountId: string): QuarantineRow[] {
    return this.db
      .query<QuarantineRow, [string]>(
        "SELECT skill_path, hash, entry, skill_md, status FROM skill_quarantine WHERE account_id = ? ORDER BY skill_path",
      )
      .all(accountId);
  }

  /** Delete stored files of versions that are neither pinned nor waiting for review. */
  private collectGarbage(accountId: string): void {
    this.db.run(
      `DELETE FROM skill_files WHERE account_id = ?1 AND NOT EXISTS (
         SELECT 1 FROM skill_pins p WHERE p.account_id = ?1 AND p.skill_path = skill_files.skill_path AND p.hash = skill_files.hash)
       AND NOT EXISTS (
         SELECT 1 FROM skill_quarantine q WHERE q.account_id = ?1 AND q.skill_path = skill_files.skill_path AND q.hash = skill_files.hash)`,
      [accountId],
    );
  }
}
