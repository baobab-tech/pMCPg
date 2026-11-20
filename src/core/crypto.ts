// Field encryption for state.db (activity payloads, db-backed vault).
// AES-256-GCM via WebCrypto. Layout: [1 byte version=1][12 byte IV][ciphertext+tag].

const VERSION = 1;

export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error("data key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function newKeyBytes(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** `aad` binds the ciphertext to its row (e.g. the secret's key), so rows cannot be swapped. */
export async function encrypt(key: CryptoKey, plaintext: string, aad = ""): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(1 + iv.byteLength + ct.byteLength);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function decrypt(key: CryptoKey, blob: Uint8Array<ArrayBuffer>, aad = ""): Promise<string> {
  if (blob[0] !== VERSION) throw new Error("unknown ciphertext version");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.subarray(1, 13), additionalData: new TextEncoder().encode(aad) },
    key,
    blob.subarray(13),
  );
  return new TextDecoder().decode(pt);
}

export async function sha256Hex(text: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(h).toString("hex");
}
