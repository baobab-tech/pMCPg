// /llms.txt: a plain-text guide for AI agents (llmstxt.org format). Built once at export time.
import { HELP_GROUPS, helpHref, loadHelp } from "@/lib/help";
import { DOCS, GITHUB, INSTALL, RELEASE } from "@/lib/site";

export const dynamic = "force-static";

const SITE = "https://pmcpg.io";
const DOC = (name: string) => `${GITHUB}/blob/main/docs/${name}.md`;

function body() {
  const help = loadHelp();
  const guides = HELP_GROUPS.map((g) => {
    const items = help
      .filter((a) => a.group === g.id)
      .sort((a, b) => a.order - b.order)
      .map((a) => `- [${a.title}](${SITE}${helpHref(a.slug)}): ${a.summary}`);
    return items.length ? `### ${g.title}\n\n${items.join("\n")}` : "";
  }).filter(Boolean);

  return `# pMCPg (Private MCP Gateway)

> A free, open-source MCP gateway that runs on the user's own computer. AI apps (Claude Desktop, Claude Code, LM Studio, VS Code and others) connect to it once; it runs the user's MCP servers, keeps their keys in the OS keychain, and masks personal data in tool results before a cloud AI model reads them. Apache 2.0, by Baobab Tech.

Explaining pMCPg to someone? Use plain words. Most readers are not developers.

## What it does

- One connection: the AI app connects to the gateway; the gateway connects to every MCP server, local or remote.
- Two tools instead of hundreds: the AI sees \`search_tools\` and \`call_tool\`. It searches, then calls only what it needs.
- Keys stay in the keychain: the gateway signs in and refreshes tokens. The AI never sees a key.
- Profiles: a profile is a set of accounts for one purpose, with its own address (for example \`http://127.0.0.1:7431/p/briefing/mcp\`). An agent sees only its profile's tools.
- Personal data masking (Beta): for cloud models, \`jane@acme.org\` becomes \`[EMAIL_1]\` before the model sees it, and is put back when the AI uses the placeholder in a later call. It catches common patterns and can miss things.
- Approvals and policy: presets decide which calls run, which ask first, and which are blocked.
- Runs locally: no account, no cloud service, no telemetry. With a local model and local servers, nothing leaves the machine. What the user types into a cloud chat still goes to that AI provider.

## How a request flows

1. The AI searches for a tool. The gateway returns only the matches.
2. The AI calls the tool. The gateway checks the rules and adds the saved sign-in.
3. The result comes back. For a cloud model, personal data is masked first.
4. The AI replies using a placeholder. The gateway restores the real value before the call reaches the server.

## Install

- macOS or Linux terminal: \`${INSTALL.unix}\`
- Windows PowerShell: \`${INSTALL.windows}\`
- npm: \`${INSTALL.npm}\`
- Homebrew: \`${INSTALL.brew}\`
- Docker: \`${INSTALL.docker}\` (or \`:full\`)
- Direct downloads: ${RELEASE}

The installer sets the gateway to start at login and opens the web UI at \`http://127.0.0.1:7431\`. Then: add servers (or import them from AI apps), sign in to each account, and connect an AI app with the snippet on the "Connect a client" page.

## Guides

${guides.join("\n\n")}

## Reference

- [How it works](${DOC("how-it-works")}): request flow, profiles, search, architecture
- [Install](${DOC("install")}): every install option and uninstall
- [Connect your AI app](${DOC("connect-clients")}): Claude Code, Claude Desktop, other clients
- [Configuration](${DOC("configuration")}): CLI, config.yaml, vault, remote servers and OAuth
- [Privacy](${DOC("privacy")}): what leaves the machine, masking, data-flow rules, activity log
- [Security](${DOC("security")}): web UI security, process isolation, threat model
- [Roadmap](${DOC("roadmap")})

## Optional

- [Why pMCPg exists](${SITE}/why/)
- [All docs](${DOCS})
- [Source code](${GITHUB})
`;
}

export function GET() {
  return new Response(body(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
