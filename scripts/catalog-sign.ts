// Sign a catalog file with the private key from the OS keychain. Writes <file>.sig: base64 of the
// 64-byte Ed25519 signature over the file's exact bytes, one line.
// Usage: bun scripts/catalog-sign.ts <file>

export const SIGNING_KEY = { service: "private-mcp-gateway", name: "catalog/signing-key" } as const;

async function main(file: string): Promise<void> {
  const pkcs8 = await Bun.secrets.get(SIGNING_KEY);
  if (!pkcs8) {
    console.error("No catalog signing key in the keychain. Run: bun scripts/catalog-keygen.ts");
    process.exit(1);
  }
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(Buffer.from(pkcs8, "base64")),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes)).toString("base64");
  await Bun.write(`${file}.sig`, `${sig}\n`);
  // The JWK's x is the public key; print it so the signer can check it is in CATALOG_PUBLIC_KEYS.
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const pub = Buffer.from(jwk.x ?? "", "base64url").toString("base64");
  console.log(`Wrote ${file}.sig (${bytes.byteLength} bytes signed, public key ${pub}).`);
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file || process.argv.length > 3) {
    console.error("Usage: bun scripts/catalog-sign.ts <file>");
    process.exit(2);
  }
  await main(file);
}
