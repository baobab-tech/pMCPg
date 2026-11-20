// ENV-1: launchers get an absolute path and an allow-listed environment; the master key leaves process.env.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { launcherCommand, launcherEnv } from "../../src/gateway/browser.ts";
import { applyConnect, claudeLauncher } from "../../src/onboarding/clients.ts";
import { takeMasterKeyFromProcessEnv } from "../../src/vault/db.ts";

const KEY = process.env.PMCPG_TEST_MASTER_KEY as string;
const TOKEN = "tok-ENV1-SECRET";

afterEach(() => {
  // Other test files read the key that test/setup.ts put in process.env.
  process.env.PMCPG_MASTER_KEY = KEY;
});

describe("browser launcher", () => {
  test("environment leaves out the master key and keeps the desktop session", () => {
    const env = launcherEnv({ PMCPG_MASTER_KEY: "x", DISPLAY: ":0", AWS_SECRET_ACCESS_KEY: "y" });
    expect(env.DISPLAY).toBe(":0");
    expect(env.PMCPG_MASTER_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
  test("launcher paths are absolute", () => {
    expect(launcherCommand("http://x", "darwin")).toEqual(["/usr/bin/open", "http://x"]);
    expect(launcherCommand("http://x", "win32", { SystemRoot: "C:\\Windows" })?.[0]).toContain(
      "rundll32.exe",
    );
    const bin = mkdtempSync(join(tmpdir(), "pmcpg-xdg-"));
    writeFileSync(join(bin, "xdg-open"), "#!/bin/sh\n");
    chmodSync(join(bin, "xdg-open"), 0o755);
    expect(launcherCommand("http://x", "linux", { PATH: bin })).toEqual([join(bin, "xdg-open"), "http://x"]);
    expect(launcherCommand("http://x", "linux", { PATH: "/nonexistent" })).toBeUndefined();
  });
});

describe("master key in process.env", () => {
  test("is read once, then deleted; a later child does not inherit it", async () => {
    process.env.PMCPG_MASTER_KEY = KEY;
    const key = takeMasterKeyFromProcessEnv();
    expect(key?.byteLength).toBe(32);
    expect(process.env.PMCPG_MASTER_KEY).toBeUndefined();
    expect(process.env.PMCPG_MASTER_KEY_FILE).toBeUndefined();
    // Cached for later vault opens in the same process.
    expect(takeMasterKeyFromProcessEnv()).toEqual(key as Uint8Array<ArrayBuffer>);
    const p = Bun.spawn(["/usr/bin/env"], { stdout: "pipe" });
    expect(await new Response(p.stdout).text()).not.toContain("PMCPG_MASTER_KEY");
  });
});

describe("claude mcp", () => {
  test.skipIf(process.platform === "win32")(
    "runs with no master key in its environment and no token in argv",
    async () => {
      process.env.PMCPG_MASTER_KEY = KEY;
      const dir = mkdtempSync(join(tmpdir(), "pmcpg-claude-"));
      const out = join(dir, "out.txt");
      const fake = join(dir, "claude");
      writeFileSync(fake, `#!/bin/sh\n{ echo "ARGV $*"; /usr/bin/env; } >> "${out}"\n`);
      chmodSync(fake, 0o755);
      const real = await claudeLauncher().catch(() => undefined);
      if (real) expect(isAbsolute(real.claude)).toBe(true);
      await applyConnect(
        "claude-code",
        {
          profile: "work",
          gatewayUrl: "http://127.0.0.1:7431",
          token: TOKEN,
          pmcpg: ["/usr/local/bin/pmcpg"],
        },
        { home: dir, platform: "darwin" },
        new Date(),
        undefined,
        async () => ({ claude: fake, env: real?.env ?? launcherEnv() }),
      );
      const text = readFileSync(out, "utf8");
      expect(text).toContain(
        "ARGV mcp add --transport stdio --scope user pmcpg-work -- /usr/local/bin/pmcpg connect work",
      );
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("PMCPG_MASTER_KEY");
    },
  );
});
