// Test isolation: never touch the real data dir or the OS keychain.
// Keychain tests opt in with PMCPG_TEST_KEYCHAIN=1 and use their own service name.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PMCPG_HOME = mkdtempSync(join(tmpdir(), "pmcpg-test-"));
// The vault deletes PMCPG_MASTER_KEY from process.env once read (ENV-1), so tests that need the key again
// read PMCPG_TEST_MASTER_KEY, which nothing deletes.
process.env.PMCPG_TEST_MASTER_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
  "base64",
);
process.env.PMCPG_MASTER_KEY = process.env.PMCPG_TEST_MASTER_KEY;
