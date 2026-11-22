import { expect, test } from "bun:test";
import { appSetupFor, slackManifest } from "../../src/onboarding/app-setup.ts";

const REDIRECT = "http://127.0.0.1:7431/oauth/callback";

test("Slack: create-app link carries the manifest with redirect, scopes, PKCE and MCP on", () => {
  const setup = appSetupFor("https://mcp.slack.com", ["chat:write", "search:read.public"], REDIRECT);
  expect(setup?.provider).toBe("Slack");
  expect(setup?.secretNeeded).toBe(false);
  const url = new URL(setup?.createUrl ?? "");
  expect(url.origin).toBe("https://api.slack.com");
  expect(url.searchParams.get("new_app")).toBe("1");
  const manifest = JSON.parse(url.searchParams.get("manifest_json") ?? "{}");
  expect(manifest).toEqual(slackManifest(REDIRECT, ["chat:write", "search:read.public"]));
  expect(manifest.oauth_config.redirect_urls).toEqual([REDIRECT]);
  expect(manifest.oauth_config.pkce_enabled).toBe(true);
  expect(manifest.settings.is_mcp_enabled).toBe(true);
});

test("Slack: the link holds no secret, and the 30 advertised scopes keep it short", () => {
  const scopes = Array.from({ length: 30 }, (_, i) => `scope${i}:read`);
  const setup = appSetupFor("https://mcp.slack.com/", scopes, REDIRECT);
  expect(setup?.createUrl).not.toMatch(/secret/i);
  expect(setup?.createUrl.length).toBeLessThan(4000);
});

test("other providers get no setup link", () => {
  expect(appSetupFor("https://auth.example.com", [], REDIRECT)).toBeUndefined();
  expect(appSetupFor("not a url", [], REDIRECT)).toBeUndefined();
});
