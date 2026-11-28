// The signed catalog bundled in the binary (scripts/embed-catalog.ts). It verifies again at load,
// against the keys this build trusts. Missing in dev and tests unless the script ran.
import { type Verified, verifyStored } from "./cache.ts";

export interface SnapshotBytes {
  bytes: Uint8Array<ArrayBuffer>;
  sig: string;
}

/** The embedded files, or null when the build embedded none. */
export async function embeddedSnapshot(): Promise<SnapshotBytes | null> {
  try {
    const { snapshot } = await import("./snapshot.gen.ts");
    if (!snapshot) return null;
    return {
      bytes: new Uint8Array(Buffer.from(snapshot.catalog, "base64")),
      sig: Buffer.from(snapshot.sig, "base64").toString("utf8"),
    };
  } catch {
    return null;
  }
}

export async function loadSnapshot(
  source: () => Promise<SnapshotBytes | null>,
  keys: readonly string[],
  now?: Date,
): Promise<Verified | undefined> {
  const s = await source();
  return s ? verifyStored(s.bytes, s.sig, keys, now) : undefined;
}
