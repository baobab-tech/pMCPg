// Owner-only modes for the files in the data directory (VLT-2).
// POSIX only. Windows has no mode bits: files inherit the folder's ACL, so chmod is skipped there.
import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32";

/** Files in the data directory that hold secrets or metadata. */
export const SENSITIVE_FILES = [
  "config.yaml",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "state.db-journal",
];

/** chmod 0600 when the file exists. Silent when it is missing or owned by someone else (a mounted volume). */
export function ownerOnly(file: string): void {
  if (isWindows) return;
  try {
    chmodSync(file, 0o600);
  } catch {
    // Missing, or not the owner: keep its mode.
  }
}

/** Create an empty file at 0600 when it is missing, then tighten it. SQLite gives -wal and -shm the same mode. */
export function createOwnerOnly(file: string): void {
  if (!existsSync(file)) closeSync(openSync(file, "a", 0o600));
  ownerOnly(file);
}

/** Tighten every sensitive file already in the data directory. */
export function tightenDataDir(dir: string): void {
  for (const name of SENSITIVE_FILES) ownerOnly(join(dir, name));
}
