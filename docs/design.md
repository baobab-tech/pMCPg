# Private MCP Gateway: Design

Technical design for the first releases. The why is in [Concept](concept.md); the research behind each choice is in [research-2026-11.md](research-2026-11.md).

**Core principles: simple and secure.** When two options conflict, pick the one with fewer moving parts, then the one with the smaller attack surface.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript | The official TS SDK v2 has the most complete MCP client: OAuth with discovery, DCR, refresh and pluggable storage; legacy SSE; Windows-safe stdio spawning |
| Runtime | Bun, compiled with `bun build --compile` | One file per OS, cross-compiled from one machine. Keychain (`Bun.secrets`), Argon2id (`Bun.password`), SQLite (`bun:sqlite`), YAML and asset embedding built in, so fewer dependencies |
| Targets | macOS arm64/x64, Windows x64/arm64, Linux x64/arm64 (glibc and musl) | Every desktop and server people run |
| Distribution | Direct download, npm (`npx`), Homebrew, Docker | One build, four doors (see *Distribution*) |
| Docker | Two tags: `slim` (remote servers only) and `full` (adds Node and uv for stdio servers) | Small and safe by default; full when needed. No docker socket |
| Desktop shell | None. Autostart at login, a per-OS launcher that starts the gateway if needed and opens the UI, and the web UI in the browser | No extra framework. A tray icon can come later per OS |
| Web UI | Next.js + shadcn/ui, static export (`output: "export"`) in `ui/`, embedded in the binary and served by the gateway; talks to a JSON API in `src/api/` | Familiar, polished components; still one binary, no Node server. React and Next are build-time only |
| UI password | First-run screen offers to set one (skippable). Required in Docker and on any non-localhost bind | Easy start, safe when exposed |
| Search | MiniSearch BM25; `search_tools` returns the top 5 with full schemas | One round trip, small library |
| Profiles | One URL and token per profile, plus a default "all" profile | Isolation decided by the connection, never by the model |
| PII models | Deferred. Patterns ship first behind a detector interface with a hardware probe | Model choice depends on hardware and on testing |
| Name | Brand **pMCPg**, command `pmcpg`, npm package `private-mcp-gateway` | Lowercase command works on case-sensitive filesystems |
| Config format | YAML (`config.yaml`), edited mainly through the web UI | Readable, comments allowed, parsed by Bun |
| Local data | `state.db` (SQLite). Secrets and log payloads encrypted with AES-256-GCM; one master key in the OS keychain (or from the environment in Docker) | No SQLCipher native build, no keychain size limits. Non-sensitive data (tool cache, pins) stays plain |
| Licence | Apache 2.0 | Permissive, with a patent grant |
| Stack proven | Spike on 2026-11-07: SDK v2 client + server, Hono front door, MiniSearch, `Bun.YAML`, `Bun.password`, `Bun.secrets` keychain round trip, compiled binary (86 MB macOS, 99 MB Linux musl, 111 MB Windows) | Spike code removed; see git history (`spike/spike.ts`) |

## Model: servers, accounts, profiles, presets

Four objects, kept separate so the UI stays simple and credentials do not repeat.

- **Server.** How to reach an MCP server: a command (stdio) or a URL (remote). No secrets.
- **Account.** One signed-in identity for one server: "Gmail, olivier@work" or "Gmail, personal". Holds the OAuth tokens or API key, in the vault. A server can have several accounts.
- **Profile.** A named set of accounts, with its own URL, client token and privacy level. "Briefing" holds work Gmail, work Slack and work Drive. "Research" holds the search and paper servers. The same account can sit in several profiles without signing in twice.
- **Preset.** A profile template from the public catalog: "Communication", "Research", "Coding". Picking one lists the servers it needs and walks the user through adding and signing in to each. Presets hold no data; they become ordinary profiles.

A default profile, **All**, contains every account and gives the "connect once, use everything" setup. Users who want isolation create more profiles and point each agent at its own URL.

The model cannot choose or switch profiles. A client connected to `/p/briefing/mcp` sees only Briefing's tools, whatever it asks for.

## Process model

One long-running process, `pmcpg serve`, started at login (desktop) or as the container's entry point (Docker). It hosts:

- the MCP front door (HTTP)
- the web UI (HTTP, same port, separate auth)
- the OAuth callback
- the downstream connections

The same binary, run with other arguments, provides the CLI (`pmcpg server add`, `pmcpg profile list`, `pmcpg ui reset-password`) and the stdio bridge (see *Front door*). Most CLI commands open `state.db` directly; a few use the running service's local API.

### Files

| Path (macOS shown) | Content |
|---|---|
| `~/Library/Application Support/Private MCP Gateway/config.yaml` | Servers, accounts (without secrets), profiles, policies. Readable and editable by hand; the UI writes it too |
| `…/state.db` | SQLite: cached tool lists and their pinned hashes, approvals, activity log, UI sessions, OAuth metadata that is not secret |
| OS keychain, service `private-mcp-gateway` | One entry: the master key that encrypts secrets in `state.db` |

Windows uses `%APPDATA%\Private MCP Gateway`, Linux uses XDG directories, and Docker uses `/data`.

## Front door

### Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `/p/<profile>/mcp` | MCP endpoint for one profile (Streamable HTTP) | Bearer client token for that profile |
| `/mcp` | Alias for the All profile | Bearer client token for All |
| `/ui/…` | Web UI | UI session cookie |
| `/oauth/callback` | Downstream OAuth redirect | `state` + PKCE |
| `/api/…` | Local API for the CLI | Local admin token, kept in the vault |

Default bind `127.0.0.1:7431`, configurable. One fixed port keeps the OAuth redirect URI stable for providers that require an exact match.

### Stdio bridge

Some clients only launch local stdio servers. Claude Desktop's config file is one, since its remote connectors are reached from the cloud and cannot see `localhost`. For these clients the binary runs as a bridge:

```json
{ "mcpServers": { "briefing": { "command": "pmcpg", "args": ["connect", "briefing"] } } }
```

`pmcpg connect` reads the profile's client token from the vault and relays stdio to `http://127.0.0.1:7431/p/briefing/mcp`. The user never handles the token.

### Tools

| Tool | Input | Output |
|---|---|---|
| `search_tools` | `query` (string), `limit` (default 5, max 10) | Matching tools: namespaced name, description, input schema, annotations |
| `call_tool` | `name` (`server__tool`, or `server@account__tool` when a profile holds two accounts of one server), `arguments` | The downstream result, after the pipeline |

`search_tools`' description ends with a menu of the profile's searchable tools, so a client knows what the gateway offers before it searches: one line per tool (`- account__tool: first sentence`, cut at 80 characters). Above 100 tools it lists one line per account with its tool names (cut at 200 characters). The menu is rebuilt on every `tools/list`; quarantined and policy-hidden tools are left out. It is the fixed cost every client pays: about 25 tokens per tool. Downstream descriptions reach the menu only as their first sentence, which limits the room for tool poisoning; full descriptions come back from `search_tools` as before.

### Protocol versions

The front door speaks the 2026-07-28 spec and older revisions, using the SDK's version negotiation. Downstream connections negotiate separately per server. The gateway translates between them; the client never sees downstream protocol details.

## Downstream connections

### Remote servers

- Streamable HTTP through the SDK client, with fallback to legacy SSE when the server only offers that.
- OAuth through the SDK's `OAuthClientProvider`. The gateway implements the provider's storage hooks against the vault, so tokens, client registrations and discovery state live in the vault under the account. Credentials are keyed by the authorization server's issuer, as the 2026-07-28 spec requires.
- A background job refreshes access tokens shortly before expiry. On a `401`, refresh once and retry; on failure, mark the account "sign-in needed" and drop its tools from search.
- HTTPS only, except `localhost` and private addresses the user marks as trusted.

### Stdio servers

- Spawned through the SDK's stdio transport (`cross-spawn`, `shell: false`, hidden window on Windows).
- **PATH.** On macOS and Linux, read the login shell's environment once at start-up so `npx`, `uvx`, nvm and pyenv resolve as they do in the terminal. On Windows, resolve `.cmd` shims through `PATHEXT`. Show the resolved path in the UI.
- **Environment.** Each server gets an allow list of system variables plus its own configured ones. Secrets are injected from the vault at spawn time and never written to `config.yaml`.
- **Process trees.** npx and uvx start grandchildren. Use a process group on Unix and a Job Object with kill-on-close on Windows, so stopping a server stops everything it started.
- **Lifecycle.** Start on first use, stop after 10 minutes idle. Cached tool lists keep search working while a server is stopped. First start allows a long timeout (npx and uvx download on first run).
- **Instances.** One process per account. Profiles that share an account share the process.

## Search

- MiniSearch index over tool name, title, description and parameter names, rebuilt per profile when a tool list changes.
- Tool lists come from the cache in `state.db`, refreshed on connect, on `tools/list_changed`, and when the list's `ttlMs` expires.
- Excluded from results: tools of accounts that need sign-in, quarantined tools, and tools blocked by policy.
- Schemas are returned whole. Descriptions longer than a set length are cut, with the cut noted.
- Embeddings later through the same interface, if keyword search proves weak in testing.

## Call pipeline

Resolve, re-hydrate placeholders, scan arguments for secrets, check policy, inject credentials, forward, scan, mask, log, return. Policy runs after re-hydration so an approval request shows the real values the tool will receive. Order and purpose are in [Concept](concept.md#call-pipeline). Each step is a function with one input and one output, so steps can be tested alone and new ones inserted without touching the others.

Every string in a result passes through scanning and masking: text, link and resource fields, `_meta`, and object keys in structured content. Image, audio and blob data pass unchanged in the first releases; the UI says so.

## Vault

Every secret (OAuth tokens and client registrations, API keys, header values, client tokens) is a row in the `secrets` table of `state.db`, encrypted with AES-256-GCM. Each row's key name is bound in as associated data, so rows cannot be swapped. Encryption keys are derived with HKDF from one 32-byte **master key**.

| Master key source | Used when |
|---|---|
| OS keychain, one entry (`private-mcp-gateway` / `gateway/master-key`), created on first run | macOS Keychain, Windows Credential Manager, Linux Secret Service (GNOME Keyring, KWallet) |
| `PMCPG_MASTER_KEY_FILE` or `PMCPG_MASTER_KEY` (base64, 32 bytes) | Docker, headless Linux, CI. Set either one and the keychain is not used |

Why one keychain entry instead of one per secret:

- Windows Credential Manager caps an entry at 2,560 bytes; OAuth token bundles can exceed it.
- macOS ties keychain access to the binary's signature, so many entries can mean many prompts after an update. One entry means at most one.
- One storage code path on every OS, with listing and transactions from SQLite.

Behaviour:

- A check row in `settings` detects a wrong master key at start-up instead of failing on first read.
- If `state.db` holds secrets but the keychain entry is missing, start-up fails with a clear message. It never silently creates a new key.
- Installs that used the earlier one-entry-per-secret layout are migrated on first start: entries move into `state.db`, then are deleted from the keychain.
- `Bun.secrets` is marked as an API that may change; only `src/vault/keychain.ts` touches it.
- CI runs the real keychain round trip on macOS, Windows and Linux (GNOME Keyring).

Secrets never appear in `config.yaml`, the log, error messages or the UI after entry. API key fields are write-only.

## Privacy layer

### Detector interface

```
detect(text, level) -> spans[{start, end, type, confidence}]
```

Detectors run in order and their spans merge. Masking and re-hydration sit after this interface and do not change when detectors do.

| Tier | Detector | Status |
|---|---|---|
| 0 | Patterns and checksums: email, phone, card (Luhn), IBAN, IP, national ID formats; gitleaks rules for secrets | First privacy release |
| 1 | Light CPU detector for names and places, small enough to run anywhere | Deferred: candidates include a small NER or a static-embedding classifier |
| 2 | GLiNER-PII or a similar ONNX model on GPU or Neural Engine | Deferred |

**Hardware probe.** Detects available accelerators (Apple Neural Engine/Metal through CoreML, DirectML on Windows, CUDA on Linux) and memory, then offers the tiers the machine can run. Tiers 1 and 2 are optional downloads, pinned by hash, run in a separate worker process so the ONNX runtime stays out of the main binary and a crash cannot take down the gateway.

### Placeholders

- Format `[TYPE_n_tag]`, for example `[EMAIL_1_k7qx]`. Numbered per session and stable within it: the same email always maps to the same placeholder. The tag comes from the session id, which is new on every gateway run, so a placeholder from before a restart cannot restore a different value that the new session numbered the same.
- Mapping kept in memory per client session; never written to disk unless the user enables it. The 2026-07-28 protocol has no connection and the front door issues no `Mcp-Session-Id`, so the stdio bridge sends a random `X-Pmcpg-Session` per process. HTTP clients without it share one session per profile. Sessions end after 8 hours idle; at most 256 are kept, least recently used dropped first.
- At most 10,000 placeholders per session, least recently used dropped first. Numbers are never reused, so a dropped placeholder is unknown, not someone else's value.
- Re-hydration scans `call_tool` arguments for placeholders and restores values before forwarding. A placeholder the session does not hold (older run, other profile, made up) stops the call with `invalid-arguments`.

### Secret scanning

gitleaks rules (MIT) converted to JS regex at build time and embedded. Applied to results and to outgoing arguments. Matches are redacted with no re-hydration.

## Web UI

- Hono with JSX rendered on the server; htmx (vendored, about 16 KB) for partial updates. One small stylesheet. No CDN, no fonts fetched, no front-end build.
- Pages: Status, Servers, Accounts, Profiles, Approvals, Activity, Settings.
- **First run:** two paths, then a "You're set" screen ([plan](plans/onboarding-v2.md)).
  - *I already use MCP servers:* import from AI apps on this computer, finish sign-ins and values, then replace the app's entries with one pMCPg entry (backup first; removing old entries is offered, not ticked).
  - *This is my first time:* a short explanation, a starter service or a pasted URL, sign in, connect one AI app, try it (the page waits for the app's first call).
  - *You're set:* optional password, privacy and approval levels for the All profile, a pointer to profiles. A password is asked first only when it is required.
- **Simple / Advanced view:** a per-browser switch (`localStorage`), Simple by default. Simple shows one "connection" per service (server and its account together) and hides transports, commands, headers, profiles and raw config; Advanced shows everything.
- **Security:**
  - Argon2id password hash (`Bun.password`).
  - `HttpOnly`, `SameSite=Strict` session cookie with idle timeout.
  - CSRF token on every change.
  - `Host` and `Origin` checks against DNS rebinding.
  - Strict CSP (no inline scripts, no outside origins).
  - Re-enter password for destructive actions.

## Onboarding

Code in `src/onboarding/`, UI API in `src/api/onboarding.ts`, CLI in `src/cli/commands-onboarding.ts`.

**Adding a server by URL.** `probeServer` sends an unauthenticated `initialize`, the same discovery Claude runs:

| Answer | Result |
|---|---|
| 2xx | No sign-in. Server name and suggested id from its answer |
| 401/403 with OAuth metadata (RFC 9728, RFC 8414) | "Sign in with \<issuer\>". Registration by DCR, CIMD, or a pasted client ID |
| 401/403 without metadata | Needs a key in a header (Authorization by default) |
| 400/404/405 | Retried as legacy SSE (GET event stream) |

**Import from AI apps.** Read-only scan of Claude Desktop (`claude_desktop_config.json` and `.mcpb` extensions), Claude Code (`~/.claude.json` user and project servers, project `.mcp.json`), LM Studio, Cursor and VS Code.

- Keeps names, commands, args and URLs. Environment variable and header values are never read into results; their names come back as "needs a value".
- Project `.mcp.json` servers are imported only if they were approved in Claude Code (`enabledMcpjsonServers`, `enableAllProjectMcpServers`, minus `disabledMcpjsonServers`). Anyone who can commit to a repository can put a command in its `.mcp.json`.
- Secrets in arguments (`GITHUB_TOKEN=…`, `--api-key …`, passwords in connection strings, known token formats) are replaced by `{{vault:…}}` references and come back as "needs a value". The stdio connector resolves them at spawn time.
- A user name and password in a URL are removed and asked for as an `Authorization` header. A server with a key in its URL path is listed with the key removed and is not imported.
- `config.yaml` validation refuses plain-text secrets in env, headers, URL parameters, URLs (password, query, path) and arguments.
- `pmcpg import --all` imports only servers reached by URL. Command-line servers run programs on this computer; pick them by number.
- Query parameters that look like secrets (`*key`, `*token`, `*secret`…) are removed from URLs and become per-account `urlParams` backed by the vault. The remote connector adds them to each request to the server's own URL.
- `npx mcp-remote <url>` wrappers become plain remote servers. `npx -y` and `npx` count as the same command.
- The same server found in several apps is one candidate, listing where it was found. Remote servers come first.
- Entries that point at this gateway (its URL, or `pmcpg connect`) are skipped, so the gateway never imports itself.
- The UI sends only candidate keys; the server re-scans and applies. Remote candidates are probed so each account gets the right sign-in type.
- Optional: one profile per Claude Code project.
- claude.ai, ChatGPT and Gemini connectors live in those vendors' clouds and cannot be imported. The user pastes the URL.

**Paste cloud connectors.** claude.ai and ChatGPT connectors live in those vendors' clouds. The Import screen gives a prompt that asks the chatbot to list them as a fenced JSON array of `{ name, url, auth, builtin }`; the user pastes the answer (`POST /api/ui/import/paste`, or `pmcpg import --paste <file|->`). `src/onboarding/paste.ts` treats the text as data and never fetches while parsing.

- Reads JSON first, then Markdown tables, bullet lists and prose with URLs.
- Keeps https URLs (http only for localhost), drops credentials and fragments, strips secret query parameters, dedupes, and caps input at 100,000 characters and 50 entries. Names that look like keys or tokens are dropped.
- Names without a URL are matched against `known-endpoints.ts`, a short list of vendor-documented public endpoints with sources. Built-in features (web search, Google Drive, Microsoft 365…) show as "not an MCP server". Anything else shows as "URL needed".
- The UI probes an entry only when the user ticks it. Import goes through `applyImport`, after the server checks each URL again.

**Connect an AI app.** Plan first (shown to the user, tokens masked), then apply with a timestamped backup. Only the app's MCP list changes.

| App | Change |
|---|---|
| Claude Desktop | One stdio entry running `pmcpg connect <profile>` with the absolute `pmcpg` path. Imported entries can be removed in the same step |
| Claude Code | `claude mcp add --transport stdio --scope user <name> -- <pmcpg> connect <profile>`, run without a shell and with no token |
| LM Studio, Cursor, VS Code | The same stdio entry. `pmcpg connect-app <app> --http` writes the profile URL and bearer header instead, as a fallback |

Applying from the UI asks for the UI password when one is set.

**Manual OAuth clients.** For providers without dynamic registration or CIMD, the account takes a client ID (in `config.yaml`) and an optional client secret (vault only).

**Universal URL.** `/mcp` accepts any profile's token; the token picks the profile. `/p/<profile>/mcp` stays as the explicit form.

**Cloud clients (v1.1).** ChatGPT, claude.ai remote connectors and Gemini call servers from their clouds, so they need a public tunnel and OAuth on the gateway's front door. Planned separately: off by default, visible indicator, auto-expiry.

## Distribution

| Channel | Audience | What ships |
|---|---|---|
| GitHub Releases | Non-technical users | macOS and Linux tar.gz, Windows zip. Signing is skipped when the signing secrets are absent. An installer that registers autostart and opens the UI is planned |
| npm | Developers | `private-mcp-gateway` with per-platform binary packages as optional dependencies (the esbuild/biome pattern). `npx private-mcp-gateway` runs the right binary |
| Homebrew | Mac and Linux developers | Tap formula pointing at the release binaries |
| Docker (GHCR) | Servers, teams, enterprise self-hosting | `slim`: binary on `distroless/cc`, remote servers only. `full`: binary on `node:24-slim` plus uv, with a cache volume for npx/uvx downloads |

**Autostart.** `pmcpg service install` registers a launchd agent (macOS), a Run key or Task Scheduler entry (Windows), or a systemd user unit (Linux). It also adds a launcher: `~/Applications/pMCPg.app` (its executable is a symlink to the binary; `LSEnvironment` sets `PMCPG_LAUNCHER=1`, which marks a bare launch as a click), or a Start-menu shortcut or `.desktop` file running `pmcpg --launcher`. A click re-registers and starts the service when nothing answers on the gateway port, waits up to 20 s, then opens the UI link with its launch code. Failures show a native dialog (osascript, a PowerShell message box, zenity). `pmcpg service uninstall` removes both.

**Signing.**

- macOS: Developer ID, hardened runtime with Bun's JIT entitlements, notarized download.
- Windows: Azure Artifact Signing (Canadian organisations are eligible), or an OV certificate on an HSM as fallback.
- Every release ships SHA-256 sums and build provenance (GitHub artifact attestations).

## Dependencies

Runtime, kept to this list:

- `@modelcontextprotocol/client`, `@modelcontextprotocol/server` (official SDK v2)
- `hono`
- `minisearch`
- `zod` (required by the SDK)
- htmx, vendored as a file

Everything else comes from Bun: secrets, password hashing, SQLite, YAML, HTTP server, test runner. New dependencies need a reason written in the pull request.

## Repository layout

```
src/
  core/        config, data model, profile resolution
  frontdoor/   MCP endpoint, search_tools, call_tool, stdio bridge
  connectors/  stdio and remote clients, OAuth provider, lifecycle
  vault/       encrypted secrets in state.db; master key from keychain or env
  search/      index and ranking
  pipeline/    policy, privacy, logging steps
  privacy/     detectors, placeholders, secret rules
  ui/          Hono routes, JSX views, static assets
  cli/         commands
test/
  fixtures/    fake stdio server, fake OAuth server, sample tool lists
docs/
```

## Testing

- Unit tests per pipeline step and per detector (`bun test`).
- Integration tests against a fake stdio server and a fake OAuth authorization server: sign-in, refresh, revoked token, rotated refresh token.
- Conformance runs against the SDK's reference servers, for each supported protocol version.
- No CI on GitHub. `bun run ci` runs locally; the release workflow's `test` job gates each tag. Windows `.cmd` shims, process-tree kill and PATH resolution are checked by hand on Windows before a release.
- A search quality set: realistic task prompts mapped to the expected tool, scored on every change to ranking.

## Milestones

| Version | Scope |
|---|---|
| 0.1 | First tagged release. Config, vault, servers, accounts, profiles; stdio and remote connectors with API key, header and OAuth auth; `search_tools` / `call_tool`; stdio bridge; CLI; web UI with first-run flow and password; import from client configs; autostart; tool pinning, trust levels, data-flow rules, approvals; tier 0 privacy; activity log; `slim` and `full` images |
| 0.2 | Signed and notarized macOS and Windows downloads with installers. npm and Homebrew publish from 0.1 once their release secrets are set |
| 0.3 | Presets from the public catalog; hardware probe and optional PII model tiers; embeddings if search testing calls for them |

## Open questions

- **Small profiles.** Testing on another gateway found its search menu cost more context than listing 45 tools directly. Should profiles under some size (say 15 tools) expose their tools directly instead of `search_tools`?
- **Soft scoping inside a profile.** Let `search_tools` take an optional group filter (for relevance only, not isolation), or keep the call to two plain tools?
- **Default port.** 7431 is a placeholder; check for clashes.
- **Windows signing.** Confirm Azure Artifact Signing onboarding for the organisation, or budget an OV certificate.
- **Catalog source.** Mirror the official MCP registry and add presets and trust hints, or link to it directly.
