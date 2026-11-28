// Ed25519 keys for catalog tests. The test private key signs fixtures only; no build trusts it.
// The placeholder is the production slot's current value (src/catalog/key.ts); its private key was discarded.

export const TEST_CATALOG_PUBLIC_KEY = "l54bvUMpn5QLsj4jBG5eOe2F5NzALwDPGxnWi9NbKII=";
export const TEST_CATALOG_PRIVATE_KEY_PKCS8 =
  "MC4CAQAwBQYDK2VwBCIEIGpI7H2+6svdIy2kNFn/1vHRP249TJ6fwzyt+u7K05Ur";
export const PLACEHOLDER_CATALOG_PUBLIC_KEY = "8AcqYznsSJFfIdprDQiXXagQ1Qb+KA5mkr/at67hwRk=";

/** Sign bytes with the test key: returns the .sig file text (base64, one line). */
export async function signWithTestKey(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(Buffer.from(TEST_CATALOG_PRIVATE_KEY_PKCS8, "base64")),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return `${Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes)).toString("base64")}\n`;
}
