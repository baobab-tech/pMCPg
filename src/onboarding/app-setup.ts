// One-click app creation for providers that need a client registered by hand.
// The link is built here, on this computer: it carries the redirect address and scopes, never a secret.
// Nothing goes through pMCPg's servers; the user creates the app in their own account.

export interface AppSetup {
  provider: string;
  /** Opens the provider's "create app" page with every field filled in. */
  createUrl: string;
  /** What the user does on that page, in order. */
  steps: string[];
  /** The provider issues a client ID only (public client), so no secret is asked for. */
  secretNeeded: boolean;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/**
 * Slack app manifest for the Slack MCP server (https://docs.slack.dev/ai/slack-mcp-server).
 * PKCE makes it a public client, which Slack requires for an http loopback redirect. The app stays
 * internal to the workspace: Slack lets only internal and Marketplace apps use MCP.
 */
export function slackManifest(redirectUrl: string, scopes: string[]) {
  return {
    display_information: {
      name: "pMCPg",
      description: "Private MCP Gateway running on your computer.",
    },
    oauth_config: {
      redirect_urls: [redirectUrl],
      scopes: { user: scopes },
      pkce_enabled: true,
    },
    settings: {
      is_mcp_enabled: true,
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Setup link for a known provider, or undefined. `issuer` comes from the server's OAuth metadata. */
export function appSetupFor(
  issuer: string,
  scopes: string[] | undefined,
  redirectUrl: string,
): AppSetup | undefined {
  if (host(issuer) === "mcp.slack.com") {
    const manifest = JSON.stringify(slackManifest(redirectUrl, scopes ?? []));
    return {
      provider: "Slack",
      createUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`,
      steps: [
        "Pick your workspace, then click Next and Create.",
        "Open Basic Information and copy the Client ID.",
        "Paste it below. Leave the secret empty.",
      ],
      secretNeeded: false,
    };
  }
  return undefined;
}
