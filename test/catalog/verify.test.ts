import { describe, expect, test } from "bun:test";
import { CATALOG_PUBLIC_KEYS } from "../../src/catalog/key.ts";
import { CatalogError, verifyCatalog } from "../../src/catalog/verify.ts";
import {
  PLACEHOLDER_CATALOG_PUBLIC_KEY,
  signWithTestKey,
  TEST_CATALOG_PUBLIC_KEY,
} from "../fixtures/catalog-keys.ts";
import { signedSample } from "../fixtures/catalog-sample.ts";

const now = new Date("2026-11-27T00:00:00Z");
const keys = [TEST_CATALOG_PUBLIC_KEY];

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return (e as CatalogError).code;
  }
}

describe("verifyCatalog", () => {
  test("accepts a good signature", async () => {
    const { bytes, sig } = await signedSample();
    const c = await verifyCatalog(bytes, sig, { keys, now, lastSerial: 7 });
    expect(c.serial).toBe(7);
  });

  test("accepts any key in the list (rotation)", async () => {
    const { bytes, sig } = await signedSample();
    expect(
      await code(verifyCatalog(bytes, sig, { keys: [PLACEHOLDER_CATALOG_PUBLIC_KEY, ...keys], now })),
    ).toBe("ok");
    expect(await code(verifyCatalog(bytes, new TextEncoder().encode(sig), { keys, now }))).toBe("ok");
  });

  test("refuses a bad signature", async () => {
    const { bytes, sig } = await signedSample();
    const tampered = new Uint8Array(bytes);
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    expect(await code(verifyCatalog(tampered, sig, { keys, now }))).toBe("bad-signature");
    expect(await code(verifyCatalog(bytes, "not base64!", { keys, now }))).toBe("bad-signature");
    expect(await code(verifyCatalog(bytes, sig, { keys: [PLACEHOLDER_CATALOG_PUBLIC_KEY], now }))).toBe(
      "bad-signature",
    );
    expect(await code(verifyCatalog(bytes, sig, { keys: [], now }))).toBe("bad-signature");
    expect(await code(verifyCatalog(bytes, sig, { keys: ["garbage"], now }))).toBe("bad-signature");
  });

  test("the shipped placeholder key verifies nothing", async () => {
    const { bytes, sig } = await signedSample();
    expect(await code(verifyCatalog(bytes, sig, { keys: CATALOG_PUBLIC_KEYS, now }))).toBe("bad-signature");
  });

  test("refuses a rollback", async () => {
    const { bytes, sig } = await signedSample({ serial: 5 });
    expect(await code(verifyCatalog(bytes, sig, { keys, now, lastSerial: 6 }))).toBe("rollback");
  });

  test("refuses an expired file", async () => {
    const { bytes, sig } = await signedSample({ expires: "2026-11-20T00:00:00Z" });
    expect(await code(verifyCatalog(bytes, sig, { keys, now }))).toBe("expired");
  });

  test("a signed file that breaks the schema is invalid, and the message quotes nothing", async () => {
    const { bytes, sig } = await signedSample({ serial: "sk-canary-123" as unknown as number });
    try {
      await verifyCatalog(bytes, sig, { keys, now });
      throw new Error("expected failure");
    } catch (e) {
      expect((e as CatalogError).code).toBe("invalid");
      expect((e as Error).message).not.toContain("sk-canary");
    }
    const junk = new TextEncoder().encode("{not json") as Uint8Array<ArrayBuffer>;
    expect(await code(verifyCatalog(junk, await signWithTestKey(junk), { keys, now }))).toBe("invalid");
  });

  test("refuses a huge body before hashing", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    expect(await code(verifyCatalog(big, "", { keys, now }))).toBe("too-large");
  });
});
