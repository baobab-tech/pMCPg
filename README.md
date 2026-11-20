<p align="center">
  <img src="docs/assets/logo.svg" alt="Private MCP Gateway logo" width="96" height="96">
</p>

<h1 align="center">Private MCP Gateway</h1>

<p align="center">
  <strong>Too many MCPs hey?</strong><br>
  A privacy-first MCP gateway that runs on your own machine.
</p>

<p align="center">
  <a href="#licence"><img alt="Licence: Apache 2.0" src="https://img.shields.io/badge/licence-Apache%202.0-blue"></a>
  <a href="https://modelcontextprotocol.io"><img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-2026--07--28-1f6feb"></a>
  <a href="docs/install.md"><img alt="Platforms: macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6e7781"></a>
  <a href="docs/install.md#docker"><img alt="Docker images: slim and full" src="https://img.shields.io/badge/docker-slim%20%7C%20full-2496ed?logo=docker&logoColor=white"></a>
  <br>
  <a href="docs/privacy.md"><img alt="Runs locally" src="https://img.shields.io/badge/runs-locally-2ea44f"></a>
  <a href="docs/privacy.md"><img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-2ea44f"></a>
  <a href="docs/design.md"><img alt="Built with TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white"></a>
  <a href="docs/design.md"><img alt="Compiled with Bun" src="https://img.shields.io/badge/Bun-compiled-14151a?logo=bun&logoColor=white"></a>
  <a href="#contributing"><img alt="Pull requests welcome" src="https://img.shields.io/badge/PRs-welcome-2ea44f"></a>
</p>

<!-- Enable once the repo is public and the first release, npm package and image exist:
  <a href="https://github.com/baobab-tech/pMCPg/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/baobab-tech/pMCPg"></a>
  <a href="https://www.npmjs.com/package/private-mcp-gateway"><img alt="npm" src="https://img.shields.io/npm/v/private-mcp-gateway?logo=npm"></a>
  <a href="https://github.com/baobab-tech/pMCPg/pkgs/container/pmcpg"><img alt="GHCR" src="https://img.shields.io/badge/ghcr.io-pmcpg-2496ed?logo=docker&logoColor=white"></a>
  <a href="https://github.com/baobab-tech/pMCPg/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/baobab-tech/pMCPg?style=social"></a>
-->

<p align="center">
  <a href="#get-started"><b>Get started</b></a> ·
  <a href="docs/how-it-works.md">How it works</a> ·
  <a href="docs/privacy.md">Privacy</a> ·
  <a href="docs/catalog.md">Catalog</a> ·
  <a href="#documentation">Docs</a>
</p>

Connect your AI app once. The gateway runs your MCP servers, keeps your keys safe, and hides personal data and keys from cloud AI models or providers.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/before-after-dark.svg">
    <img alt="Without a gateway: three AI apps each connect to five servers, with keys copied into every app, and the setup depends on Claude. With Private MCP Gateway: each app connects once, and the gateway connects to the servers." src="docs/assets/before-after-light.svg" width="100%">
  </picture>
</p>

## What it is

- **One connection.** Your AI app connects to the gateway. The gateway connects to your MCP servers, local or remote.
- **Tools on demand.** The AI sees two tools, `search_tools` and `call_tool`, instead of hundreds.
- **Keys in your keychain.** The gateway signs in for you and refreshes tokens. The AI never sees a key.
- **Private by design.** It runs on your computer. No account, no cloud service, no tracking.
- **Personal data masking (Beta).** For cloud AI models, `jane@acme.org` becomes `[EMAIL_1]` before the model sees it. It catches common patterns and can miss things, so don't rely on it alone for sensitive data.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/where-data-goes-dark.svg">
    <img alt="Your machine holds the Claude app, a coding agent, a local AI app with a local model, the gateway and local MCP servers. The cloud holds the cloud AI model and remote MCP servers. Apps that use a cloud model send tool results to the provider, so personal data is masked first. The local AI app and local model keep everything on the machine." src="docs/assets/where-data-goes-light.svg" width="100%">
  </picture>
</p>

With a local model and local servers, nothing leaves your machine. [More on privacy →](docs/privacy.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/connectors-swipe-dark.svg">
    <img alt="Before: Claude holds seven connectors, each a URL or command with its own key, several with expired sign-ins. After: Private MCP Gateway is Claude's only connector, the servers sit behind it, and all are healthy." src="docs/assets/connectors-swipe-light.svg" width="100%">
  </picture>
</p>

## Get started

1. **Install.** On macOS or Linux, paste this into a terminal:

   ```bash
   curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh
   ```

   On Windows, paste this into PowerShell:

   ```powershell
   irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex
   ```

   The script checks the download, sets the gateway to start at login and opens the web UI. Other options and uninstall: [Install](docs/install.md).
2. **Add servers.** Import them from your AI apps, or paste a command or URL. A searchable [catalog](docs/catalog.md) with presets is coming soon.
3. **Sign in** to each account.
4. **Connect your AI app** with the snippet on the "Connect a client" page.

Developers:

```bash
npx private-mcp-gateway                              # or: brew install baobab-tech/tap/pmcpg
claude mcp add briefing -- pmcpg connect briefing      # connect Claude Code to the "briefing" profile
```

Docker: `ghcr.io/baobab-tech/pmcpg:slim` or `:full`. See [Install](docs/install.md).

## For social impact organizations

Anyone can use Private MCP Gateway. Baobab Tech builds it with a focus on nonprofits, NGOs, foundations and development agencies. The [catalog](docs/catalog.md#social-impact-organizations-collection), coming soon, will have presets for fundraising, grants research, M&E and reporting, communications and program data, with strict privacy defaults.

## Documentation

| | |
|---|---|
| [How it works](docs/how-it-works.md) | Request flow, profiles, search, architecture |
| [Install](docs/install.md) | One-line install, npm, Homebrew, Docker, manual download, uninstall |
| [Connect your AI app](docs/connect-clients.md) | Claude Code, Claude Desktop, other clients |
| [Configuration](docs/configuration.md) | CLI, `config.yaml`, vault, remote servers and OAuth |
| [Privacy](docs/privacy.md) | What leaves your machine, masking, data-flow rules, approvals, activity log |
| [Security](docs/security.md) | Web UI security, process isolation, threat model |
| [Catalog](docs/catalog.md) | Server entries and presets (coming soon) |
| [Concept](docs/concept.md) and [Design](docs/design.md) | Why it exists and how it is built |

## Contributing

Issues and pull requests are welcome. New runtime dependencies need a written reason in the pull request. Diagrams are generated by `python3 docs/assets/src/build_svgs.py`.

## Licence

[Apache 2.0](LICENSE)
