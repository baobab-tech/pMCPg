<p align="center">
  <img src="docs/assets/logo.svg" alt="pMCPg logo" width="96" height="96">
</p>

<h1 align="center">pMCPg · Private MCP Gateway</h1>

<p align="center">
  One local connection between your AI apps and your MCP servers.<br>
  It holds the sign-ins, masks personal data and logs every call, on your own machine.
</p>

<p align="center">
  <a href="https://github.com/baobab-tech/pMCPg/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/baobab-tech/pMCPg"></a>
  <a href="https://www.npmjs.com/package/private-mcp-gateway"><img alt="npm" src="https://img.shields.io/npm/v/private-mcp-gateway?logo=npm"></a>
  <a href="LICENSE"><img alt="Licence: Apache 2.0" src="https://img.shields.io/badge/licence-Apache%202.0-blue"></a>
  <a href="https://modelcontextprotocol.io"><img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-2026--07--28-1f6feb"></a>
  <a href="docs/install.md"><img alt="Platforms: macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6e7781"></a>
  <a href="docs/install.md#docker"><img alt="Docker images: slim and full" src="https://img.shields.io/badge/docker-slim%20%7C%20full-2496ed?logo=docker&logoColor=white"></a>
  <a href="docs/privacy.md"><img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-2ea44f"></a>
</p>

<p align="center">
  <a href="https://pmcpg.io">pmcpg.io</a> ·
  <a href="#install"><b>Install</b></a> ·
  <a href="docs/how-it-works.md">How it works</a> ·
  <a href="docs/privacy.md">Privacy</a> ·
  <a href="#docs">Docs</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/before-after-dark.svg">
    <img alt="Without a gateway: three AI apps each connect to five servers, with keys copied into every app. With pMCPg: each app connects once, and pMCPg connects to the servers." src="docs/assets/before-after-light.svg" width="100%">
  </picture>
</p>

AI apps (Claude Desktop, Claude Code, VS Code, LM Studio) → **pMCPg** → your MCP servers, local (`npx`, `uvx`) or remote.

## Who it's for

- **New to connectors.** Let your AI app use your tools. pMCPg runs on your computer, holds the sign-ins, and masks personal data in what servers send back to the AI.
- **You already use a few servers.** Import them from your AI apps, then each app connects once, to pMCPg. Keys live in your keychain, not in config files.
- **IT and small teams.** Profiles, approval rules, masking and an encrypted activity log, on each machine or in Docker. Org-wide management and a self-hosted enterprise edition are coming ([roadmap](docs/roadmap.md)).

## Install

macOS and Linux:

```bash
curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex
```

The script checks the download, starts pMCPg at login and opens the web UI. Direct downloads: [pmcpg.io](https://pmcpg.io/#download) or [GitHub Releases](https://github.com/baobab-tech/pMCPg/releases/latest).

Developers: `npx private-mcp-gateway` · `brew install baobab-tech/tap/pmcpg` · `docker pull ghcr.io/baobab-tech/pmcpg:slim`. Details and uninstall: [Install](docs/install.md).

## Get started

1. **Install** with the line above. The web UI opens.
2. **Add servers.** Import them from Claude Desktop, Claude Code, VS Code or LM Studio, or paste a command or URL. Connectors added in Claude's cloud: [move them over](https://pmcpg.io/help/move-claude-connectors/).
3. **Sign in** once in your browser, for each server that needs it.
4. **Connect your AI app** with one click on the web UI's "Connect a client" page, or `pmcpg connect-app <app>`. Then ask your AI: it searches pMCPg for the right tool and calls it.

## Features

- **Search over all tools.** The AI sees two tools, `search_tools` and `call_tool`, in front of any number of servers.
- **Local and remote servers.** Stdio servers (`npx`, `uvx`) and remote HTTP servers, grouped into profiles. Each profile has its own URL and token.
- **OAuth sign-in.** Client ID metadata documents (CIMD), dynamic registration or a pasted client ID, with token refresh in the background.
- **Encrypted secrets.** One master key in the OS keychain; secrets encrypted in `state.db`. The AI never sees a key.
- **Personal data masking (Beta).** `jane@acme.org` becomes `[EMAIL_1]` before a cloud model reads it. It catches common patterns and can miss things.
- **Approvals.** Presets `open`, `balanced` or `careful`, or custom rules. Answer in the web UI or the terminal.
- **Activity log.** Every search and call, encrypted, values left out. Kept 30 days by default.
- **Tool pinning and secret scanning.** A tool that changes is quarantined until you review it. Keys and tokens in results are redacted.
- **Skills.** Keep skills (a `SKILL.md` and its files) in one library, give each profile the ones it needs, and every connected AI app can use them. Skills that your servers publish can pass through too, off by default and reviewed when they change ([design](docs/skills.md)).

No account, no telemetry. With a local model and local servers, nothing leaves your machine. [What leaves your machine →](docs/privacy.md)

## Docs

- [How it works](docs/how-it-works.md): request flow, profiles, search
- [Install](docs/install.md) · [Connect your AI app](docs/connect-clients.md) · [Configuration](docs/configuration.md)
- [Privacy](docs/privacy.md) · [Approvals and rules](docs/policy.md) · [Security model](docs/security.md)
- [Concept](docs/concept.md) · [Design](docs/design.md) · [Roadmap](docs/roadmap.md)
- [Contributing](docs/CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Issues](https://github.com/baobab-tech/pMCPg/issues)

Built by [Baobab Tech](https://pmcpg.io/why/) for nonprofits, NGOs and foundations, and for anyone else. Licence: [Apache 2.0](LICENSE).
