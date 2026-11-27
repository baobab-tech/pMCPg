# Configuration

The web UI and the CLI cover the same actions. Both write to `config.yaml`.

## CLI

```bash
pmcpg serve                                # run the gateway (MCP endpoint, web UI, OAuth callback)
pmcpg service install                      # start at login (launchd, Task Scheduler, systemd user unit)
pmcpg service uninstall

pmcpg server add linear --url https://mcp.linear.app/mcp
pmcpg server add files --command "npx -y @modelcontextprotocol/server-filesystem ~/Documents"
pmcpg server list
pmcpg import                               # from Claude Desktop, Claude Code, Cursor, VS Code, LM Studio
pmcpg export --format codex -o config.toml # server list for another app; keys never included (--share for a team)

pmcpg account signin linear --name work    # opens the browser for OAuth
pmcpg account list

pmcpg profile create briefing --privacy strict
pmcpg profile add briefing linear@work gmail@work
pmcpg profile list

pmcpg catalog search grants                # coming soon: prints a note, no network request
pmcpg log tail
pmcpg open                                 # opens the web UI with a one-time link
pmcpg ui reset-password                    # works when the service is stopped
```

Most CLI commands open `state.db` directly; a few use the running service's local API. The web UI and the CLI cover the same actions.

## Servers that run on this computer

`--command` (or `command:` in `config.yaml`) starts a stdio server such as `npx` or `uvx`.

- Started on first use, stopped after 10 minutes idle. The first start can be slow while npx or uvx download the server.
- Spawned without a shell, with an allow-listed environment plus the server's and account's `env`. Secrets go in as `{{vault:name}}` references.
- `PATH` comes from your login shell on macOS and Linux, so nvm, pyenv, uv and Homebrew tools resolve as in a terminal.
- Changing the command, args or env restarts the server.
- `pmcpg import` brings these in from other apps; `--all` skips them, pick by number. Secret values are asked for again.
- A server already running on `localhost` over HTTP is added with `--url`, not `--command`.
- Docker needs the `full` image. See [Install](install.md#docker).
- Windows: not yet tested.
- No sandbox: see [Security](security.md#stdio-servers).

## config.yaml

Servers, accounts, profiles and policies live in one file. You can edit it by hand; the web UI writes to it too. It holds references to secrets, never the secrets.

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Private MCP Gateway/config.yaml` |
| Windows | `%APPDATA%\Private MCP Gateway\config.yaml` |
| Linux | `$XDG_CONFIG_HOME/private-mcp-gateway/config.yaml` |
| Docker | `/data/config.yaml` |

```yaml
servers:
  gmail:
    command: npx -y some-gmail-mcp          # stdio server, started on first use
    trust: external-content                 # results may carry untrusted text
  linear:
    url: https://mcp.linear.app/mcp
    auth: oauth                             # discovered from the server
    trust: private-data
  web-search:
    url: https://api.example-search.com/mcp
    auth: header
    headers:
      Authorization: "Bearer {{vault:web-search}}"
    trust: external-content
  mailer:
    url: https://mcp.example-mailer.com/mcp
    auth: oauth
    trust: can-send

accounts:
  gmail@work:     { server: gmail }
  gmail@personal: { server: gmail }
  linear@work:    { server: linear }
  web-search:     { server: web-search }
  mailer@work:    { server: mailer }

profiles:
  briefing:
    accounts: [gmail@work, linear@work, mailer@work]
    privacy: strict
  research:
    accounts: [web-search]
    privacy: standard
    read_only: true
  personal:
    accounts: [gmail@personal]
    privacy: standard

policies:
  approvals:
    - destructive: true                     # any tool with destructiveHint
    - tool: mailer__send_campaign
  flows:
    - after: external-content               # once the session has read web or email content
      require_approval: can-send            # sending tools need approval
  privacy:
    exceptions:
      - server: linear
        fields: [assignee.name]             # data the model needs in clear
```

## Vault

Secrets are encrypted rows in `state.db` (AES-256-GCM). The key that encrypts them, the master key, comes from:

| Where | When |
|---|---|
| The OS keychain: one entry, created on first run | macOS, Windows, Linux desktop (GNOME Keyring, KWallet) |
| `PMCPG_MASTER_KEY_FILE` or `PMCPG_MASTER_KEY` | Docker, headless Linux. Generate with `openssl rand -base64 32` |

- Each account has its own secrets. "Work Linear" and "personal Linear" hold different tokens.
- Secrets never appear in `config.yaml`, the log, error messages or the UI after entry. Key fields are write-only.
- OAuth tokens are bound to their server (RFC 8707) and sent only to that server.
- The web UI shows where the master key comes from.

## Remote servers and OAuth

- Streamable HTTP by default, legacy HTTP+SSE for older servers.
- Auth methods: none, API key or bearer token, custom headers, OAuth 2.1.
- OAuth follows the MCP authorization spec: protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), a client ID metadata document (CIMD) or dynamic client registration (RFC 7591) when offered, PKCE, and resource indicators (RFC 8707). Other providers take a client ID and secret in the web UI.
- CIMD client ID: `https://baobab-tech.github.io/pMCPg/oauth/client.json`, a public file listing the redirect on port 7431. On another port, or to drop the dependency on that file, host your own copy and set `PMCPG_CLIENT_METADATA_URL` to its https URL.
- The callback is `http://127.0.0.1:7431/oauth/callback` (the gateway's host and port).
- Tokens refresh in the background before they expire. On a `401` the gateway refreshes once and retries.
- A failed refresh marks the account "sign-in needed" and removes its tools from search until you sign in again.
- Signing out revokes the token at the provider where supported, then deletes it.
- Remote calls require HTTPS, except `localhost` and private addresses you mark as trusted. An outbound proxy can be set.

---

[← Back to README](../README.md)
