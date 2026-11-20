// Runs the real `pmcpg privacy` commands in a child process.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetPrivacy } from "../../src/cli/commands-privacy.ts";

const MAIN = join(import.meta.dir, "../../src/cli/main.ts");

async function pmcpg(args: string[], stdin?: string) {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", PMCPG_HOME: process.env.PMCPG_HOME ?? "" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

describe("pmcpg privacy check", () => {
  test("masks text given as an argument and prints a table", async () => {
    const r = await pmcpg(["privacy", "check", "Mail jane@acme.com or jane@acme.com, call +44 20 7946 0958"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Mail \[EMAIL_1_(\w{4})\] or \[EMAIL_1_\1\], call \[PHONE_1_\1\]/);
    expect(r.out).toMatch(/EMAIL\s+2\s+email/);
    expect(r.out).toMatch(/PHONE\s+1\s+phone-intl/);
    expect(r.out).not.toContain("jane@acme.com");
  });

  test("reads stdin with -", async () => {
    const r = await pmcpg(["privacy", "check", "-"], "IBAN GB82 WEST 1234 5698 7654 32\n");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/IBAN \[IBAN_1_\w{4}\]/);
  });

  test("reads a file with @path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcpg-privacy-"));
    const file = join(dir, "sample.txt");
    writeFileSync(file, "Name: Jane Doe\nSSN 123-45-6789\n");
    const strict = await pmcpg(["privacy", "check", "--level", "strict", `@${file}`]);
    expect(strict.code).toBe(0);
    expect(strict.out).toMatch(/Name: \[PERSON_1_\w{4}\]\nSSN \[NATIONAL_ID_1_\w{4}\]/);
    const standard = await pmcpg(["privacy", "check", `@${file}`]);
    expect(standard.out).toMatch(/Name: Jane Doe\nSSN \[NATIONAL_ID_1_\w{4}\]/);
  });

  test("redacts secrets at every level", async () => {
    const token = `${"ghp"}_R7k2mQx9Lp4vT8nW3zY6bH1cF5jD0sAeGuIo`;
    const r = await pmcpg(["privacy", "check", `token ${token}`]);
    expect(r.out).toContain("token [SECRET_REDACTED]");
    expect(r.out).toMatch(/SECRET\s+1\s+github-pat/);
    expect(r.out).not.toContain(token);
  });

  test("says when nothing is found", async () => {
    const r = await pmcpg(["privacy", "check", "Version 1.2.3 released on 2026-11-07"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing found at level standard.");
  });

  test("rejects a bad level and a missing file", async () => {
    const bad = await pmcpg(["privacy", "check", "--level", "off", "x"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--level must be standard or strict");
    const missing = await pmcpg(["privacy", "check", "@/no/such/file.txt"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("No such file");
  });

  test("needs exactly one input", async () => {
    expect((await pmcpg(["privacy", "check"])).code).toBe(2);
  });
});

describe("pmcpg privacy explain", () => {
  test("lists levels and types in plain words", async () => {
    const r = await pmcpg(["privacy", "explain"]);
    expect(r.code).toBe(0);
    for (const s of [
      "off",
      "standard",
      "strict",
      "Email addresses",
      "Government ID numbers",
      "Names of people",
      "gitleaks",
    ])
      expect(r.out).toContain(s);
    expect(r.out).toContain("Kenyan KRA PINs");
  });
});

describe("pmcpg privacy reset", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };

  test("sends the profile to the running gateway and prints counts", async () => {
    const sent: (string | undefined)[] = [];
    const o = io();
    const code = await resetPrivacy("work", o.io, async (p) => {
      sent.push(p);
      return Response.json({ sessions: 2, placeholders: 5 });
    });
    expect(code).toBe(0);
    expect(sent).toEqual(["work"]);
    expect(o.out[0]).toBe("Forgot 5 masked value(s) in 2 session(s) of profile work.");
  });

  test("reports a stopped gateway and refusals", async () => {
    const down = io();
    const failing = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };
    expect(await resetPrivacy(undefined, down.io, failing)).toBe(1);
    expect(down.err[0]).toContain("not running");
    const refused = io();
    const notFound = async () => Response.json({ error: "No such profile." }, { status: 404 });
    expect(await resetPrivacy("ghost", refused.io, notFound)).toBe(1);
    expect(refused.err).toEqual(["No such profile."]);
  });

  test("is listed in help", async () => {
    const r = await pmcpg(["privacy", "reset", "--help"]);
    expect(r.out + r.err).toContain("--profile");
  });
});
