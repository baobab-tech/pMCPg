import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createFrontDoor } from "../../src/frontdoor/server.ts";
import { placeholderFor, rehydrateText, sessionTag } from "../../src/privacy/mask.ts";
import { SessionStore } from "../../src/privacy/sessions.ts";
import { MiniSearchToolIndex } from "../../src/search/minisearch-index.ts";
import type { GatewayEvent } from "../../src/store/events.ts";

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: restores spies made in tests
  (crypto.randomUUID as any).mockRestore?.();
});

describe("SessionStore.reset", () => {
  test("drops one profile's sessions and counts their placeholders", () => {
    const store = new SessionStore();
    const work = store.get("work", "client-a-0001");
    placeholderFor(work, "EMAIL", "jane@acme.com");
    placeholderFor(work, "PHONE", "+44 20 7946 0958");
    const other = store.get("home", undefined);
    placeholderFor(other, "EMAIL", "bob@home.example");

    expect(store.reset("work")).toEqual({ sessions: 1, placeholders: 2 });
    expect(work.placeholders.size).toBe(0);
    expect(store.get("home", undefined)).toBe(other);
    expect(other.placeholders.size).toBe(1);
    expect(store.get("work", "client-a-0001")).not.toBe(work);
  });

  test("without a profile, drops every session", () => {
    const store = new SessionStore();
    placeholderFor(store.get("work", undefined), "EMAIL", "a@x.example");
    placeholderFor(store.get("home", undefined), "EMAIL", "b@x.example");
    expect(store.reset()).toEqual({ sessions: 2, placeholders: 2 });
    expect(store.reset()).toEqual({ sessions: 0, placeholders: 0 });
  });

  test("an old placeholder stays literal text in the new session, even with the same number", () => {
    const store = new SessionStore();
    const before = store.get("work", undefined);
    const old = placeholderFor(before, "EMAIL", "jane@acme.com");
    store.reset("work");
    const after = store.get("work", undefined);
    const fresh = placeholderFor(after, "EMAIL", "someone@else.example");
    expect(fresh).not.toBe(old);
    expect(sessionTag(after)).not.toBe(sessionTag(before));
    const r = rehydrateText(`send to ${old}`, after);
    expect(r.text).toBe(`send to ${old}`);
    expect(r.unknown).toEqual([old]);
  });

  test("a new session never reuses a dropped session's tag", () => {
    const store = new SessionStore();
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    const spy = spyOn(crypto, "randomUUID");
    spy.mockImplementationOnce(() => ids[0] as `${string}-${string}-${string}-${string}-${string}`);
    const first = store.get("work", undefined);
    store.reset("work");
    // The first id offered again would give the retired tag; the store must skip it.
    spy.mockImplementationOnce(() => ids[0] as `${string}-${string}-${string}-${string}-${string}`);
    spy.mockImplementationOnce(() => ids[1] as `${string}-${string}-${string}-${string}-${string}`);
    const second = store.get("work", undefined);
    expect(second.id).toBe(ids[1] as string);
    expect(sessionTag(second)).not.toBe(sessionTag(first));
  });
});

describe("front door resetPrivacy", () => {
  test("emits a privacy-reset event with counts only", () => {
    const events: GatewayEvent[] = [];
    const fd = createFrontDoor({
      index: new MiniSearchToolIndex(),
      getProfile: () => undefined,
      getClientToken: () => undefined,
      getConnector: () => undefined,
      steps: [],
      events: { emit: (e) => events.push(e) },
    });
    expect(fd.resetPrivacy("work")).toEqual({ sessions: 0, placeholders: 0 });
    expect(fd.resetPrivacy()).toEqual({ sessions: 0, placeholders: 0 });
    expect(events).toEqual([
      { type: "privacy-reset", profileId: "work", sessions: 0, placeholders: 0 },
      { type: "privacy-reset", sessions: 0, placeholders: 0 },
    ]);
  });
});
