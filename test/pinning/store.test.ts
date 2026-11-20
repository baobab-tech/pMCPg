import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { DownstreamTool } from "../../src/connectors/connector.ts";
import { toolHash } from "../../src/gateway/catalog.ts";
import { pinHash, SqlitePinStore } from "../../src/pinning/store.ts";
import { openDb } from "../../src/store/db.ts";

const tool = (name: string, description = `${name} does things.`, props: Record<string, unknown> = {}) =>
  ({ name, description, inputSchema: { type: "object", properties: props } }) satisfies DownstreamTool;

const names = (ts: { name: string }[]) => ts.map((t) => t.name);

describe("SqlitePinStore", () => {
  let db: Database;
  let pins: SqlitePinStore;
  beforeEach(() => {
    db = openDb(":memory:");
    pins = new SqlitePinStore(db);
  });

  test("hash matches the catalogue's", () => {
    const t = tool("a", "x", { q: { type: "string" } });
    expect(pinHash(t)).toBe(toolHash(t));
  });

  test("first listing pins everything", () => {
    const r = pins.check("acct", [tool("a"), tool("b")]);
    expect(names(r.allowed)).toEqual(["a", "b"]);
    expect(r.quarantined).toEqual([]);
    expect(pins.check("acct", [tool("a"), tool("b")]).allowed).toHaveLength(2);
  });

  test("an empty first listing still pins the account", () => {
    pins.check("acct", []);
    const r = pins.check("acct", [tool("a")]);
    expect(r.allowed).toEqual([]);
    expect(r.quarantined[0]?.reason).toBe("new");
  });

  test("changed and new tools are quarantined; title and annotations count", () => {
    pins.check("acct", [tool("a"), tool("b"), tool("d")]);
    const r = pins.check("acct", [
      { ...tool("a"), title: "A", annotations: { readOnlyHint: true } },
      tool("b", "b now also sends your files elsewhere."),
      tool("c"),
      tool("d"),
    ]);
    expect(names(r.allowed)).toEqual(["d"]);
    expect(r.quarantined.map((q) => [q.toolName, q.reason])).toEqual([
      ["a", "changed"],
      ["b", "changed"],
      ["c", "new"],
    ]);
    const b = r.quarantined[1];
    expect(b?.pinned?.description).toBe("b does things.");
    expect(b?.current.description).toBe("b now also sends your files elsewhere.");
    expect(pins.quarantined("acct")).toEqual(r.quarantined);
  });

  test("approve pins the new version", () => {
    pins.check("acct", [tool("a")]);
    pins.check("acct", [tool("a", "changed")]);
    pins.approve("acct", "a");
    expect(pins.quarantined()).toEqual([]);
    expect(names(pins.check("acct", [tool("a", "changed")]).allowed)).toEqual(["a"]);
    // The old version is now the changed one.
    expect(pins.check("acct", [tool("a")]).quarantined[0]?.reason).toBe("changed");
  });

  test("reject hides the tool until it changes again", () => {
    pins.check("acct", [tool("a")]);
    pins.check("acct", [tool("a", "evil")]);
    pins.reject("acct", "a");
    let r = pins.check("acct", [tool("a", "evil")]);
    expect(r.allowed).toEqual([]);
    expect(r.quarantined).toEqual([]);
    expect(pins.quarantined()).toEqual([]);

    r = pins.check("acct", [tool("a", "evil again")]);
    expect(r.quarantined[0]?.current.description).toBe("evil again");

    // Back to the pinned version: allowed, nothing left to review.
    r = pins.check("acct", [tool("a")]);
    expect(names(r.allowed)).toEqual(["a"]);
    expect(pins.quarantined()).toEqual([]);
  });

  test("a rejected new tool stays hidden", () => {
    pins.check("acct", [tool("a")]);
    pins.check("acct", [tool("a"), tool("b")]);
    pins.reject("acct", "b");
    expect(names(pins.check("acct", [tool("a"), tool("b")]).allowed)).toEqual(["a"]);
    // Approving a rejected tool later still works.
    pins.approve("acct", "b");
    expect(names(pins.check("acct", [tool("a"), tool("b")]).allowed)).toEqual(["a", "b"]);
  });

  test("tools that disappear leave the review list", () => {
    pins.check("acct", [tool("a")]);
    pins.check("acct", [tool("a"), tool("b")]);
    expect(pins.quarantined()).toHaveLength(1);
    pins.check("acct", [tool("a")]);
    expect(pins.quarantined()).toEqual([]);
  });

  test("approve and reject throw for tools that are not quarantined", () => {
    pins.check("acct", [tool("a")]);
    expect(() => pins.approve("acct", "a")).toThrow("not quarantined");
    expect(() => pins.reject("acct", "zzz")).toThrow("not quarantined");
  });

  test("accounts are independent; forget starts over", () => {
    pins.check("one", [tool("a")]);
    pins.check("two", [tool("a")]);
    pins.check("one", [tool("a", "changed")]);
    pins.check("two", [tool("a", "changed")]);
    expect(pins.quarantined("one")).toHaveLength(1);
    expect(pins.quarantined()).toHaveLength(2);
    pins.forget("one");
    expect(pins.quarantined()).toHaveLength(1);
    expect(names(pins.check("one", [tool("a", "changed")]).allowed)).toEqual(["a"]);
  });

  test("state survives reopening the store", () => {
    pins.check("acct", [tool("a")]);
    pins.check("acct", [tool("a", "changed")]);
    const again = new SqlitePinStore(db);
    expect(again.quarantined()[0]?.toolName).toBe("a");
  });
});
