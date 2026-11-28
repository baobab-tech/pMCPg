// The only place the catalog's address and signing keys live. A test keeps every other source file
// free of catalog URLs.

export const CATALOG_URL = "https://pmcpg.io/catalog/v1/catalog.json";
/** Detached Ed25519 signature over the exact bytes at CATALOG_URL, base64, one line. */
export const CATALOG_SIG_URL = `${CATALOG_URL}.sig`;

/**
 * Ed25519 public keys (raw 32 bytes, base64) accepted for the catalog. Several during a rotation:
 * add the new key, ship a release, sign with the new key, then drop the old one.
 *
 * PLACEHOLDER: no private key exists for this one, so nothing verifies until it is replaced with the
 * output of `bun scripts/catalog-keygen.ts` (docs/catalog.md, "Signing").
 */
export const CATALOG_PUBLIC_KEYS: readonly string[] = ["8AcqYznsSJFfIdprDQiXXagQ1Qb+KA5mkr/at67hwRk="];

/** True until the placeholder above is replaced. The UI can say "catalog not available yet". */
export const CATALOG_KEY_IS_PLACEHOLDER = true;
