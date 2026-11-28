// GatewayHandle.catalog() and refreshCatalog() in a running gateway: no fetch with the placeholder key
// or with catalog.enabled: false.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_NO_KEY, CATALOG_OFF } from "../../src/catalog/service.ts";
import { type Gateway, startGateway } from "../../src/gateway/runtime.ts";

let gw: Gateway;
const fetchSpy = spyOn(globalThis, "fetch");

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "pmcpg-catalog-rt-"));
  writeFileSync(join(home, "config.yaml"), "{}\n");
  gw = await startGateway({ home, listen: false, openBrowser: async () => {}, uiAssets: {} });
  fetchSpy.mockClear();
});
afterAll(async () => {
  await gw?.close();
  fetchSpy.mockRestore();
});

describe("gateway catalog", () => {
  test("catalog() reads only; refreshCatalog() makes no request with the placeholder key", async () => {
    const v = await gw.handle.catalog();
    expect(v).toMatchObject({ serial: 0, entries: [], presets: [], fetchedAt: null, source: "snapshot" });
    expect((await gw.handle.refreshCatalog()).error).toBe(CATALOG_NO_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("catalog.enabled: false applies after a config change", async () => {
    await gw.handle.updateConfig((d) => {
      d.catalog.enabled = false;
    });
    expect((await gw.handle.catalog()).error).toBe(CATALOG_OFF);
    expect((await gw.handle.refreshCatalog()).error).toBe(CATALOG_OFF);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
