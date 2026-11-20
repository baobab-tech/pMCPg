// Performance: tier 0 must stay cheap on CPU. Budgets are loose for slow CI runners.
import { expect, test } from "bun:test";
import { MAX_PLACEHOLDERS, maskText, newSession } from "../../src/privacy/mask.ts";

const PARAGRAPH = `Meeting notes 2026-11-07, version 2.4.1. Contact jane.doe@acme.com or +44 20 7946 0958.
Payment to GB82 WEST 1234 5698 7654 32 for invoice 4471-2210. Server 10.0.4.17 responded at 12:30:45.
Name: Wanjiku Kamau, P.O. Box 12345-00100 Nairobi. The quick brown fox jumps over the lazy dog; api docs at
https://example.org/docs?id=12345. Order #4111111111111111 shipped. Password policy: rotate every 90 days.
`;

test("masks 1 MB of mixed text within budget", async () => {
  const text = PARAGRAPH.repeat(Math.ceil(1_000_000 / PARAGRAPH.length));
  expect(text.length).toBeGreaterThanOrEqual(1_000_000);
  for (const level of ["standard", "strict"] as const) {
    const t0 = performance.now();
    const out = await maskText(text, newSession(), { level, secrets: true });
    const ms = performance.now() - t0;
    console.log(`${level}: 1 MB in ${ms.toFixed(0)} ms`);
    expect(out).not.toContain("jane.doe@acme.com");
    expect(ms).toBeLessThan(5000);
  }
}, 30_000);

test("many small strings (structured content) within budget", async () => {
  const session = newSession();
  const t0 = performance.now();
  for (let i = 0; i < 20_000; i++)
    await maskText(`user${i}@example.org status ok`, session, { level: "standard", secrets: true });
  const ms = performance.now() - t0;
  console.log(`20k small strings in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(5000);
  // Capped: the oldest placeholders are dropped.
  expect(session.placeholders.size).toBe(MAX_PLACEHOLDERS);
}, 30_000);

test("pathological input does not backtrack for long", async () => {
  const inputs = [
    "a".repeat(200_000),
    "1 ".repeat(100_000),
    `${"x@".repeat(50_000)}`,
    `api_key = ${"=".repeat(100_000)}`,
    `curl ${"-H ".repeat(30_000)}`,
    `Name: ${"Aa ".repeat(50_000)}`,
  ];
  for (const s of inputs) {
    const t0 = performance.now();
    await maskText(s, newSession(), { level: "strict", secrets: true });
    expect(performance.now() - t0).toBeLessThan(3000);
  }
}, 60_000);
