import { describe, expect, test } from "bun:test";
import { FREE_FAILURES, GLOBAL_FREE_FAILURES, LoginThrottle, MAX_BACKOFF_MS } from "../../src/api/auth.ts";

describe("LoginThrottle (WEB-2)", () => {
  test("backoff doubles after the free failures and never exceeds the cap", () => {
    const t = new LoginThrottle();
    let now = 0;
    for (let i = 0; i < FREE_FAILURES; i++) expect(t.begin("a", now)).toBe(0);
    expect(t.begin("a", now)).toBe(1000);
    for (let i = 0; i < 20; i++) {
      now += MAX_BACKOFF_MS;
      expect(t.begin("a", now)).toBe(0);
      expect(t.begin("a", now)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    }
  });

  test("one client's failures do not lock out another", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < FREE_FAILURES * 3; i++) t.begin("attacker", 0);
    expect(t.begin("attacker", 0)).toBeGreaterThan(0);
    expect(t.begin("owner", 0)).toBe(0);
  });

  test("the global cap applies to everyone, for at most the backoff cap", () => {
    const t = new LoginThrottle();
    let now = 0;
    for (let i = 0; i < GLOBAL_FREE_FAILURES; i++) expect(t.begin(`c${i}`, now)).toBe(0);
    expect(t.begin("owner", now)).toBe(1000);
    for (let i = 0; i < 20; i++) {
      now += MAX_BACKOFF_MS;
      t.begin(`more${i}`, now);
    }
    expect(t.begin("owner", now)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(t.begin("owner", now + MAX_BACKOFF_MS)).toBe(0);
  });

  test("success clears the client's count", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < FREE_FAILURES; i++) t.begin("a", 0);
    t.succeed("a");
    expect(t.begin("a", 0)).toBe(0);
  });
});
