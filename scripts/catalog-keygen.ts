// Make the catalog signing key pair. The private key goes into the OS keychain (Bun.secrets) and is
// never printed or written to disk; the public key is printed for src/catalog/key.ts.
// Usage: bun scripts/catalog-keygen.ts [--replace]
import { SIGNING_KEY } from "./catalog-sign.ts";

const replace = process.argv.includes("--replace");
const existing = await Bun.secrets.get(SIGNING_KEY);
if (existing && !replace) {
  console.error(
    `A catalog signing key already exists in the keychain (${SIGNING_KEY.service} / ${SIGNING_KEY.name}). ` +
      "Pass --replace to make a new one; the old public key then stops matching new signatures.",
  );
  process.exit(1);
}

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const pub = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64");
await Bun.secrets.set({ ...SIGNING_KEY, value: pkcs8 });

console.log("Private key stored in the keychain.");
console.log("Public key (add to CATALOG_PUBLIC_KEYS in src/catalog/key.ts):");
console.log(pub);
