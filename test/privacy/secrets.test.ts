import { describe, expect, test } from "bun:test";
import { goToJs } from "../../src/privacy/secrets/gen-gitleaks.ts";
import { secretRules } from "../../src/privacy/secrets/rules.ts";
import { findSecrets } from "../../src/privacy/secrets/scan.ts";

// Fake but well-formed secrets. Built from parts so this file does not trip secret scanners.
const rnd = "R7k2mQx9Lp4vT8nW3zY6bH1cF5jD0sAeGuIo";
const SECRETS: [rule: string, text: string, secret: string][] = [
  ["github-pat", `token ${"ghp"}_${rnd}`, `${"ghp"}_${rnd}`],
  ["aws-access-token", `key ${"AKIA"}Z7Q3XK4P2MLN6RTV`, `${"AKIA"}Z7Q3XK4P2MLN6RTV`],
  [
    "slack-bot-token",
    `${"xoxb"}-2837461928-9182736451-aB3dE5fG7hJ9kL1mN3pQ5rS7`,
    `${"xoxb"}-2837461928-9182736451-aB3dE5fG7hJ9kL1mN3pQ5rS7`,
  ],
  [
    "stripe-access-token",
    `stripe ${"sk_live"}_4eC39HqLyjWDarjtT1zdp7dc`,
    `${"sk_live"}_4eC39HqLyjWDarjtT1zdp7dc`,
  ],
  [
    "jwt",
    `Bearer ${"eyJ"}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`,
    `${"eyJ"}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`,
  ],
  ["generic-api-key", 'api_key = "f8Kd93jLq0Zx7Vb2Nm5Rt1Yw"', "f8Kd93jLq0Zx7Vb2Nm5Rt1Yw"],
  ["url-credentials", "postgres://admin:s3cr3tP4ss@db.example.com/app", "s3cr3tP4ss"],
  ["labelled-password", "Password: Tr0ub4dor&3x", "Tr0ub4dor&3x"],
  ["labelled-password", "mot de passe : Soleil#2026", "Soleil#2026"],
];

describe("secret rules", () => {
  test("vendored gitleaks rules compile and have keywords", () => {
    const rules = secretRules();
    expect(rules.length).toBeGreaterThan(200);
    for (const r of rules) expect(r.kw?.length).toBeGreaterThan(0);
  });

  test.each(SECRETS)("%s", (rule, text, secret) => {
    const found = findSecrets(text);
    const hit = found.find((f) => text.slice(f.start, f.end) === secret);
    expect(hit, `${rule} in ${JSON.stringify(found)}`).toBeDefined();
  });

  test("private key block", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${"MIIEpAIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9Oi6ZQnkmgWr5xMxCbVlkRk8nH3dQ7yGK3v8jXk2pLrQ9wT5mN4bC1vF6hJ8kL0".repeat(2)}\n-----END RSA PRIVATE KEY-----`;
    expect(findSecrets(pem).map((f) => f.ruleId)).toContain("private-key");
  });

  test.each([
    ["template variable", `api_key = "${"$"}{API_KEY}"`],
    ["placeholder", "password: [SECRET_REDACTED]"],
    ["masked password", "password: ********"],
    ["low entropy", 'token = "aaaaaaaaaaaaaaaaaaaa"'],
    ["documentation key", `${"AKIA"}IOSFODNN7EXAMPLE`],
    ["prose about tokens", "Rotate your access token every 90 days."],
    ["url without password", "https://user@example.com/path"],
    ["url with variable password", `postgres://app:${"$"}{DB_PASSWORD}@db/app`],
    ["git sha", "commit 5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c"],
    ["uuid", "id 014df517-39d1-4453-b7b3-9930c563627c"],
  ])("not a secret: %s", (_label, text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  test("secret offsets cover only the secret, not its label", () => {
    const text = "Password: Tr0ub4dor&3x";
    const [f] = findSecrets(text);
    expect(text.slice(f?.start, f?.end)).toBe("Tr0ub4dor&3x");
  });
});

describe("gitleaks conversion", () => {
  test.each([
    ["(?i)abc", "abc", "i"],
    ["\\b(p8e-(?i)[a-z0-9]{32})", "\\b(p8e-(?i:[a-z0-9]{32}))", ""],
    ["(?:a(?i)b|c)", "(?:a(?i:b)|c)", ""],
    ["[[:alnum:]_]+\\z", "[a-zA-Z0-9_]+$", ""],
    ["(?P<name>x)", "(?<name>x)", ""],
  ])("%s", (go, source, flags) => {
    expect(goToJs(go)).toEqual({ source, flags });
  });
});
