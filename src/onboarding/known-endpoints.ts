// Public remote MCP endpoints, used when a pasted connector list has a name but no URL.
// Each URL was read on the vendor's own docs or official GitHub repo on 2026-11-07 (source in the comment).
// Left out: endpoints only seen in third-party directories, Google Workspace (developer preview, needs
// your own OAuth client), Plaid (machine-to-machine OAuth only), Semgrep (repo deprecated).
import type { PasteAuth } from "./paste.ts";

export interface KnownEndpoint {
  vendor: string;
  /** Names a chatbot may use for it, compared after normalizeName. */
  names: string[];
  url: string;
  auth: PasteAuth;
}

export const KNOWN_ENDPOINTS: KnownEndpoint[] = [
  // https://linear.app/docs/mcp
  { vendor: "Linear", names: ["Linear"], url: "https://mcp.linear.app/mcp", auth: "oauth" },
  // https://developers.notion.com/docs/get-started-with-mcp
  { vendor: "Notion", names: ["Notion"], url: "https://mcp.notion.com/mcp", auth: "oauth" },
  // https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/
  {
    vendor: "Atlassian",
    names: ["Atlassian", "Atlassian Rovo", "Jira", "Confluence", "Jira and Confluence"],
    url: "https://mcp.atlassian.com/v2/mcp",
    auth: "oauth",
  },
  // https://developers.asana.com/docs/using-asanas-mcp-server
  { vendor: "Asana", names: ["Asana"], url: "https://mcp.asana.com/v2/mcp", auth: "oauth" },
  // https://docs.stripe.com/mcp
  { vendor: "Stripe", names: ["Stripe"], url: "https://mcp.stripe.com", auth: "oauth" },
  // https://mcp.sentry.dev (linked from https://docs.sentry.io/product/sentry-mcp/)
  { vendor: "Sentry", names: ["Sentry"], url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
  // https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/
  {
    vendor: "Cloudflare",
    names: ["Cloudflare", "Cloudflare API"],
    url: "https://mcp.cloudflare.com/mcp",
    auth: "oauth",
  },
  {
    vendor: "Cloudflare",
    names: ["Cloudflare Docs", "Cloudflare Documentation"],
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "none",
  },
  // https://github.com/github/github-mcp-server
  { vendor: "GitHub", names: ["GitHub"], url: "https://api.githubcopilot.com/mcp/", auth: "oauth" },
  // https://huggingface.co/docs/hub/hf-mcp-server
  {
    vendor: "Hugging Face",
    names: ["Hugging Face", "HuggingFace", "HF"],
    url: "https://huggingface.co/mcp",
    auth: "oauth",
  },
  // https://www.canva.dev/blog/developers/canva-mcp-ga/
  { vendor: "Canva", names: ["Canva"], url: "https://api.canva.com/connect/v1/mcp", auth: "oauth" },
  // https://docs.zapier.com/mcp/get-started/connect/other
  { vendor: "Zapier", names: ["Zapier"], url: "https://mcp.zapier.com/api/v1/connect", auth: "key" },
  // https://developer.paypal.com/tools/mcp-server/
  { vendor: "PayPal", names: ["PayPal"], url: "https://mcp.paypal.com/http", auth: "oauth" },
  // https://developer.squareup.com/docs/mcp
  { vendor: "Square", names: ["Square"], url: "https://mcp.squareup.com/mcp", auth: "oauth" },
  // https://developers.intercom.com/docs/guides/mcp
  { vendor: "Intercom", names: ["Intercom"], url: "https://mcp.intercom.com/mcp", auth: "oauth" },
  // https://developer.monday.com/api-reference/docs/integrate-with-monday-mcp
  { vendor: "monday.com", names: ["monday.com", "Monday"], url: "https://mcp.monday.com/mcp", auth: "oauth" },
  // https://developer.box.com/guides/box-mcp/remote/
  { vendor: "Box", names: ["Box"], url: "https://mcp.box.com", auth: "oauth" },
  // https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server
  { vendor: "HubSpot", names: ["HubSpot"], url: "https://mcp.hubspot.com", auth: "oauth" },
  // https://vercel.com/docs/agent-resources/vercel-mcp
  { vendor: "Vercel", names: ["Vercel"], url: "https://mcp.vercel.com", auth: "oauth" },
  // https://supabase.com/docs/guides/getting-started/mcp
  { vendor: "Supabase", names: ["Supabase"], url: "https://mcp.supabase.com/mcp", auth: "oauth" },
  // https://neon.com/docs/ai/neon-mcp-server
  { vendor: "Neon", names: ["Neon", "Neon Postgres"], url: "https://mcp.neon.tech/mcp", auth: "oauth" },
  // https://developers.webflow.com/mcp/reference/getting-started
  { vendor: "Webflow", names: ["Webflow"], url: "https://mcp.webflow.com/mcp", auth: "oauth" },
  // https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp
  { vendor: "Wix", names: ["Wix"], url: "https://mcp.wix.com/mcp", auth: "oauth" },
  // https://help.figma.com/hc/en-us/articles/32132100833559
  { vendor: "Figma", names: ["Figma"], url: "https://mcp.figma.com/mcp", auth: "oauth" },
  // https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/
  { vendor: "Netlify", names: ["Netlify"], url: "https://mcp.netlify.com/mcp", auth: "oauth" },
  // https://developers.make.com/mcp-server
  { vendor: "Make", names: ["Make", "Make.com"], url: "https://mcp.make.com/v2", auth: "oauth" },
  // https://support.airtable.com/docs/using-the-airtable-mcp-server
  { vendor: "Airtable", names: ["Airtable"], url: "https://mcp.airtable.com/mcp", auth: "oauth" },
  // https://help.dropbox.com/integrations/connect-dropbox-mcp-server
  { vendor: "Dropbox", names: ["Dropbox"], url: "https://mcp.dropbox.com/mcp", auth: "oauth" },
  // https://docs.slack.dev/ai/mcp-server/
  { vendor: "Slack", names: ["Slack"], url: "https://mcp.slack.com/mcp", auth: "oauth" },
  // https://github.com/upstash/context7
  { vendor: "Context7", names: ["Context7"], url: "https://mcp.context7.com/mcp", auth: "key" },
  // https://docs.exa.ai/reference/exa-mcp
  { vendor: "Exa", names: ["Exa", "Exa Search"], url: "https://mcp.exa.ai/mcp", auth: "none" },
  // https://docs.granola.ai/help-center/sharing/integrations/mcp
  { vendor: "Granola", names: ["Granola"], url: "https://mcp.granola.ai/mcp", auth: "oauth" },
  // https://docs.fireflies.ai/getting-started/mcp-configuration
  {
    vendor: "Fireflies",
    names: ["Fireflies", "Fireflies.ai"],
    url: "https://api.fireflies.ai/mcp",
    auth: "oauth",
  },
  // https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server
  { vendor: "ClickUp", names: ["ClickUp"], url: "https://mcp.clickup.com/mcp", auth: "oauth" },
];

/**
 * Features and connectors built into Claude or ChatGPT that are not MCP servers a user can move.
 * Sources: https://support.claude.com/en/articles/10166901 (Claude's built-in connectors) and
 * OpenAI's help center on ChatGPT connectors. Names that also have a public MCP above are left out.
 */
export const KNOWN_BUILTINS: string[] = [
  "Web search",
  "Search",
  "Browsing",
  "Deep research",
  "Research",
  "Code interpreter",
  "Analysis",
  "Analysis tool",
  "Data analysis",
  "Image generation",
  "DALL-E",
  "Canvas",
  "Artifacts",
  "Memory",
  "Google Drive",
  "Gmail",
  "Google Calendar",
  "Google Docs",
  "Google Sheets",
  "Google Slides",
  "Google Contacts",
  "Microsoft 365",
  "SharePoint",
  "OneDrive",
  "Outlook",
  "Outlook Email",
  "Outlook Calendar",
  "Teams",
  "Microsoft Teams",
];
