// Verify a fetched catalog: signature over the raw bytes first, then the schema, then freshness.
// Nothing in the file is parsed before its signature checks out. Error messages never quote the file.
import { type CatalogFile, CatalogFile as CatalogSchema } from "./schema.ts";

/** Larger than any real catalog; stops a hostile server from making us hash a huge body. */
export const CATALOG_MAX_BYTES = 5 * 1024 * 1024;

export type CatalogErrorCode = "too-large" | "bad-signature" | "invalid" | "expired" | "rollback";

export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface VerifyOptions {
  /** Raw Ed25519 public keys, base64. Any one may have signed. */
  keys: readonly string[];
  /** Highest serial accepted before (cache). A lower serial is refused. */
  lastSerial?: number;
  /** Clock, for tests. */
  now?: Date;
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  const s = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return undefined;
  return new Uint8Array(Buffer.from(s, "base64"));
}

async function importPublicKey(b64: string): Promise<CryptoKey | undefined> {
  const raw = decodeBase64(b64);
  if (raw?.byteLength !== 32) return undefined;
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return undefined;
  }
}

/** True when any key in `keys` signed `bytes`. `signature` is the .sig file: base64 of 64 bytes. */
export async function verifySignature(
  bytes: Uint8Array<ArrayBuffer>,
  signature: string | Uint8Array<ArrayBuffer>,
  keys: readonly string[],
): Promise<boolean> {
  const sigText = typeof signature === "string" ? signature : new TextDecoder().decode(signature);
  if (sigText.length > 200) return false;
  const sig = decodeBase64(sigText);
  if (sig?.byteLength !== 64) return false;
  for (const k of keys) {
    const key = await importPublicKey(k);
    if (key && (await crypto.subtle.verify({ name: "Ed25519" }, key, sig, bytes))) return true;
  }
  return false;
}

/** Verify and parse. Throws CatalogError; returns the parsed file only when every check passes. */
export async function verifyCatalog(
  bytes: Uint8Array<ArrayBuffer>,
  signature: string | Uint8Array<ArrayBuffer>,
  opts: VerifyOptions,
): Promise<CatalogFile> {
  if (bytes.byteLength > CATALOG_MAX_BYTES)
    throw new CatalogError("too-large", `The catalog is larger than ${CATALOG_MAX_BYTES} bytes.`);
  if (!(await verifySignature(bytes, signature, opts.keys)))
    throw new CatalogError("bad-signature", "The catalog's signature does not match a trusted key.");

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CatalogError("invalid", "The catalog is not valid JSON.");
  }
  const parsed = CatalogSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
    throw new CatalogError(
      "invalid",
      `The catalog does not match format 1 (${parsed.error.issues.length} problems, first${where}).`,
    );
  }
  const file = parsed.data;
  const now = (opts.now ?? new Date()).getTime();
  if (Date.parse(file.expires) <= now)
    throw new CatalogError("expired", `The catalog expired on ${file.expires}.`);
  if (opts.lastSerial !== undefined && file.serial < opts.lastSerial)
    throw new CatalogError(
      "rollback",
      `The catalog is older (serial ${file.serial}) than one already seen (serial ${opts.lastSerial}).`,
    );
  return file;
}
