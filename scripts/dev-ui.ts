// Development entry point: runs the gateway with the web UI mounted, without touching runtime.ts.
// Usage: PMCPG_HOME=/tmp/pmcpg-dev bun scripts/dev-ui.ts [--port 7431] [--host 127.0.0.1]
// Serves the UI from ui/out (build it first with `bun run --cwd ui build`).
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Hono } from "hono";
import { scanUiDir } from "../src/api/assets.ts";
import { createUiApi } from "../src/api/routes.ts";
import { startGateway } from "../src/gateway/runtime.ts";

const { values } = parseArgs({ options: { port: { type: "string" }, host: { type: "string" } } });
const gw = await startGateway({
  listen: false,
  port: values.port ? Number(values.port) : undefined,
  // PMCPG_NO_BROWSER=1: show sign-in links in the UI only, never open the system browser.
  ...(process.env.PMCPG_NO_BROWSER ? { openBrowser: async () => {} } : {}),
});
const host = values.host ?? gw.config().gateway.host;
const port = values.port ? Number(values.port) : gw.config().gateway.port;

const app = new Hono();
// The UI API answers /api/ui/* itself, so the CLI's /api/* admin-token check never sees those paths.
// PMCPG_SCAN_HOME: scan and change AI apps' configs under this folder instead of the real home.
const scanHome = process.env.PMCPG_SCAN_HOME;
app.route(
  "/",
  createUiApi(gw.handle, {
    db: gw.db,
    bindHost: host,
    assets: scanUiDir(join(import.meta.dir, "..", "ui", "out")),
    onboarding: {
      // Apps started by "Connect" run the real CLI, not this dev script.
      pmcpgCommand: () => [process.execPath, join(import.meta.dir, "..", "src", "cli", "main.ts")],
      ...(scanHome ? { scanEnv: () => ({ home: scanHome, platform: process.platform }) } : {}),
    },
  }),
);
app.route("/", gw.app);

const server = Bun.serve({ hostname: host, port, fetch: app.fetch });
console.log(`pMCPg dev UI at http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/`);

const stop = async () => {
  server.stop(true);
  await gw.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
