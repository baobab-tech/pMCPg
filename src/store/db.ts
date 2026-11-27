// state.db: one SQLite file (bun:sqlite). Owner: core (Phase 0) for the schema.
// Modules own their tables; schema changes go through the main session as new migrations.
import { Database } from "bun:sqlite";
import { createOwnerOnly, ownerOnly } from "../core/file-mode.ts";

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE tool_cache (            -- owner: connectors / search
    account_id   TEXT NOT NULL,
    tool_name    TEXT NOT NULL,
    definition   TEXT NOT NULL,        -- JSON DownstreamTool
    hash         TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (account_id, tool_name)
  );
  CREATE TABLE tool_pins (             -- owner: pinning (Phase 2)
    account_id   TEXT NOT NULL,
    tool_name    TEXT NOT NULL,
    hash         TEXT NOT NULL,
    approved_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, tool_name)
  );
  CREATE TABLE activity (              -- owner: activity log (Phase 2)
    id           INTEGER PRIMARY KEY,
    at           INTEGER NOT NULL,
    type         TEXT NOT NULL,
    profile_id   TEXT,
    account_id   TEXT,
    payload      BLOB NOT NULL         -- encrypted JSON GatewayEvent (see crypto.ts)
  );
  CREATE INDEX activity_at ON activity(at);
  CREATE TABLE approvals (             -- owner: policy (Phase 2)
    id           TEXT PRIMARY KEY,
    created_at   INTEGER NOT NULL,
    profile_id   TEXT NOT NULL,
    tool         TEXT NOT NULL,
    status       TEXT NOT NULL,        -- pending | approved | denied | expired
    decided_at   INTEGER
  );
  CREATE TABLE ui_sessions (           -- owner: web UI (Phase 2)
    id_hash      TEXT PRIMARY KEY,     -- SHA-256 of the cookie value
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE secrets (               -- owner: vault; AES-256-GCM rows, master key from keychain or env
    key          TEXT PRIMARY KEY,
    value        BLOB NOT NULL         -- AES-256-GCM, see crypto.ts
  );
  CREATE TABLE settings (              -- owner: core; non-secret key/value
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL
  );
  `,
  // 2: tool pinning keeps the pinned definition (for diffs) and the quarantine state
  `
  ALTER TABLE tool_pins ADD COLUMN definition TEXT;  -- JSON DownstreamTool as approved
  CREATE TABLE tool_pin_accounts (     -- owner: pinning; accounts listed at least once (trust on first use)
    account_id   TEXT PRIMARY KEY,
    pinned_at    INTEGER NOT NULL
  );
  CREATE TABLE tool_quarantine (       -- owner: pinning; listed tools that differ from their pin
    account_id   TEXT NOT NULL,
    tool_name    TEXT NOT NULL,
    hash         TEXT NOT NULL,
    definition   TEXT NOT NULL,        -- JSON DownstreamTool as listed
    status       TEXT NOT NULL,        -- pending | rejected
    seen_at      INTEGER NOT NULL,
    PRIMARY KEY (account_id, tool_name)
  );
  `,
  // 3: server skills (MCP Skills extension): pins, review queue and the stored files. See docs/skills.md.
  `
  CREATE TABLE skill_pins (            -- owner: skills; approved resource set per server skill
    account_id   TEXT NOT NULL,
    skill_path   TEXT NOT NULL,        -- path under the server's skill:// root, e.g. "acme/refunds"
    hash         TEXT NOT NULL,        -- SHA-256 of the sorted (path, digest, size) set
    entry        TEXT NOT NULL,        -- JSON skill entry as approved
    skill_md     TEXT NOT NULL,        -- SKILL.md as approved, for the review diff
    approved_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, skill_path)
  );
  CREATE TABLE skill_pin_accounts (    -- owner: skills; accounts synced at least once (trust on first use)
    account_id   TEXT PRIMARY KEY,
    pinned_at    INTEGER NOT NULL
  );
  CREATE TABLE skill_quarantine (      -- owner: skills; listed skills that differ from their pin
    account_id   TEXT NOT NULL,
    skill_path   TEXT NOT NULL,
    hash         TEXT NOT NULL,
    entry        TEXT NOT NULL,        -- JSON skill entry as listed
    skill_md     TEXT NOT NULL,
    status       TEXT NOT NULL,        -- pending | rejected
    seen_at      INTEGER NOT NULL,
    PRIMARY KEY (account_id, skill_path)
  );
  CREATE TABLE skill_files (           -- owner: skills; fetched, verified bytes of listed skills
    account_id   TEXT NOT NULL,
    skill_path   TEXT NOT NULL,
    hash         TEXT NOT NULL,        -- skill hash these files belong to
    path         TEXT NOT NULL,        -- relative path inside the skill
    digest       TEXT NOT NULL,        -- sha256:<hex> of content
    content      BLOB NOT NULL,
    PRIMARY KEY (account_id, skill_path, hash, path)
  );
  `,
];

/** Open (or create) state.db. On POSIX the file, -wal and -shm are 0600; existing ones are tightened. */
export function openDb(path: string): Database {
  const onDisk = path !== "" && path !== ":memory:" && !path.startsWith("file:");
  // SQLite creates -wal and -shm with the database file's mode, so create that one first at 0600.
  if (onDisk) createOwnerOnly(path);
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  if (onDisk) for (const f of [`${path}-wal`, `${path}-shm`]) ownerOnly(f);
  return db;
}

export function migrate(db: Database): void {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.run(MIGRATIONS[v] as string);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}
