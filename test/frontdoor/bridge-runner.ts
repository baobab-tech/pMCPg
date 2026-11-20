// Runs the stdio bridge for tests. Port and token come from the test's explicit environment.
import { runBridge } from "../../src/frontdoor/bridge.ts";

await runBridge({
  profile: process.env.PMCPG_TEST_PROFILE ?? "all",
  port: Number(process.env.PMCPG_TEST_PORT),
  getToken: async () => process.env.PMCPG_TEST_TOKEN ?? "",
});
