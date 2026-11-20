# Private MCP Gateway: Concept

Draft for design and build. No code yet.

## Summary

A small local service that sits between an AI client (Claude, a coding agent, a local model) and all of a person's MCP servers, whether they run on the machine or at a remote URL. The client connects to the gateway once. The gateway holds the server list, credentials and profiles, shows the client only the tools a task needs, and filters what flows between the model and those servers.

Everything runs and stays on the person's machine.

The gateway does three jobs:

1. **Route.** One connection, many servers, tools loaded on demand through search.
2. **Hold secrets.** The gateway signs in to each server, local or remote, keeps tokens fresh, and stores credentials encrypted on the machine, with the key in the OS keychain. The client never sees them.
3. **Protect data.** Personal data in tool results can be masked before it reaches the model, and policies control which tools can see which data.

## The problem

### Context and sprawl

- Each connected MCP server adds tool descriptions to the model's context. Twenty servers can mean hundreds of tools and tens of thousands of tokens before the first message. Tool choice accuracy drops as the list grows.
- Each client keeps its own server list and its own copies of keys. Adding a server or rotating a key means editing several configs.
- Users toggle connectors by hand and lose track of what is connected where.
- Existing gateways merge servers into one endpoint but still expose every tool up front. Most target teams and hosted infrastructure.

### Privacy

- Tool results go straight into the model's context. An email search returns names, addresses, phone numbers and account numbers, and all of it is sent to the model provider.
- Any tool result can carry instructions. A web page or an email can tell the model to call another tool and send data somewhere.
- Tool descriptions can change after a user approves a server. A description that was harmless last week can carry injected instructions today.
- Credentials sit in plain JSON config files, copied across clients.
- Remote servers each run their own OAuth sign-in per client. Tokens expire, and when a refresh fails the user finds out mid-task, in whichever client hit it first.
- Nobody keeps a record of what the model read, which tools it called, or what it sent out.

## Principles

1. **Simple and secure.** These two come first. When options conflict, pick fewer moving parts, then the smaller attack surface.
2. **Local first.** The gateway, the registry, all secrets and all logs live on the user's machine. No account, no sign-up, no telemetry.
3. **Sovereignty.** We never hold user data, credentials or usage. Any shared service we run carries public information only.
4. **One connection.** The client connects to the gateway and nothing else. Adding a server never requires reconnecting the client.
5. **Context is a budget.** Tools load on demand through search. The client sees what the task needs.
6. **Least exposure.** The model sees the minimum data needed to do the task. Masking, policies and logs are on by default and easy to adjust.
7. **Profiles.** A profile is a named set of accounts for one purpose ("briefing", "research"), with its own URL and privacy policy.
8. **Secrets per account.** "Work Google" and "personal Google" are separate accounts with separate stored credentials, and never mix.
9. **One choke point.** Every call passes through the gateway. Policy, masking, approval and logging live there.
10. **Client agnostic.** Works with any MCP client, including small local models, where context savings matter most.
11. **Small.** Few features, done well. Easy to read, audit and fork.

## How it works

### Components

```
 AI client ──MCP──▶ ┌──────────────────── Private MCP Gateway ────────────────────┐
 (Claude, coding    │                                                            │
  agent, local AI)  │  Front door     search_tools / call_tool, per profile      │
                    │  Discovery      tool index (keyword, later embeddings)     │
 Browser ──HTTP───▶ │  Web UI         setup, sign-ins, approvals, log            │
 (localhost)        │  Policy         allow lists, read-only, approvals, flows   │
                    │  Privacy        PII masking, secret scanning, re-hydration │
                    │  Vault          encrypted secrets, key in OS keychain      │
                    │  Connectors     stdio, Streamable HTTP, legacy SSE         │
                    │  Log            local, encrypted, with retention           │
                    └─────────┬──────────────────┬──────────────────┬────────────┘
                              ▼                  ▼                  ▼
                       local server        remote server       remote server
                       (stdio child)       (HTTPS + OAuth)     (HTTPS + API key)
```

### Registry

A local file listing the user's MCP servers. Each entry records:

- how to start or reach the server (stdio command, container image, or remote URL)
- how the gateway authenticates to it (none, API key, bearer token, custom headers, or OAuth)
- which profiles include it
- which credentials it needs and where they are stored
- a pinned hash of its tool descriptions (see *Tool pinning*)
- a trust level that feeds the privacy policy

Users add servers by hand, from an existing client config (import from Claude Desktop, Claude Code, VS Code and other coding agents), or from the public directory.

Illustrative shape, not a final format:

```yaml
profiles:
  work:
    privacy: strict
  personal:
    privacy: standard

servers:
  gmail-work:
    profile: work
    transport: stdio
    command: npx -y some-gmail-mcp
    credentials: vault:work/google
    trust: external-content     # results may carry untrusted text
  notes:
    profile: [work, personal]
    transport: http
    url: http://localhost:7800/mcp
    trust: local
  linear:
    profile: work
    transport: http
    url: https://mcp.linear.app/mcp
    auth: oauth                 # discovered from the server; tokens in the vault
    trust: private-data
  search-api:
    profile: [work, personal]
    transport: http
    url: https://api.example-search.com/mcp
    auth: header
    headers:
      Authorization: "Bearer {{vault:shared/example-search}}"
    trust: external-content
```

The registry file holds references to secrets, never the secrets themselves.

### Front door

The gateway exposes a fixed set of tools to the client:

| Tool | Purpose |
|---|---|
| `search_tools` | Free-text query. Returns the best matching tools with their schemas. |
| `call_tool` | Takes a namespaced name (`server__tool`) and arguments. Runs the call through the pipeline below. |

A third tool, `describe_tool`, may be added if search returns names only and schemas load on request (open question).

The client's context holds two or three tools, whatever the size of the registry.

### Profiles

Four objects, kept separate:

- **Server.** How to reach an MCP server. No secrets.
- **Account.** One signed-in identity on one server ("Gmail, work"). Holds the tokens or key.
- **Profile.** A named set of accounts for one purpose, with its own URL, client token and privacy level. "Briefing" holds work Gmail, Slack and Drive; "Research" holds the search servers. One account can sit in several profiles without signing in twice.
- **Preset.** A profile template from the public catalog that walks the user through adding and signing in to each server.

A default **All** profile holds every account, for users who want one connection. A client connected to a profile can only see and call that profile's accounts; the model cannot switch profiles.

### Discovery

The gateway indexes tool names, descriptions and parameter names from every server in the profile. Ranking starts with BM25 keyword search. Local embeddings can be added later behind the same interface. The index rebuilds when a server is added, removed or changes its tool list.

Registry changes appear on the next search. No reconnect, and no reliance on client support for `tools/list_changed`.

### Call pipeline

Every `call_tool` request passes through the same steps, in order:

1. **Resolve.** Find the server and tool in the active profile. Unknown or out-of-profile tools fail.
2. **Re-hydrate.** Replace masked tokens in the arguments with their real values (see *PII masking*), and scan the arguments for secrets.
3. **Policy check.** Apply allow lists, read-only mode and data-flow rules. Pause for approval if a rule requires it; the approval request shows the real values.
4. **Inject credentials.** Fetch the account's keys or tokens from the vault, refreshing an OAuth token first if it is about to expire, and attach them to the downstream request.
5. **Forward.** Send the call to the server and wait, with a timeout. On a `401`, refresh once and retry; if that fails, return a clear "sign-in needed" error and flag the server in the web UI.
6. **Scan.** Check the result for secrets, PII and known injection patterns.
7. **Mask.** Replace PII in the result according to the profile's privacy level.
8. **Log.** Record the call, the policy decisions and what was masked. Values stay out of the log unless the user turns that on.
9. **Return.** Send the filtered result to the client.

### Client auth

The client authenticates once, to the gateway, with a local token or a per-profile key. Credentials for downstream servers never pass through the client or the model.

### Remote servers

Many MCP servers are hosted services reached over HTTPS. The gateway is their client: it holds the connection, the sign-in and the tokens, so the AI client never talks to them directly.

**Transports.** Streamable HTTP is the default. Legacy HTTP+SSE is supported for older servers. The gateway keeps one session per account, reconnects with backoff, and resumes where the server supports it.

**Auth methods.**

| Method | How it works |
|---|---|
| None | Public servers. |
| API key / bearer token | The user pastes a key in the web UI. It goes to the vault; the registry references it. |
| Custom headers | For servers that want keys in their own header names. Values come from the vault. |
| OAuth 2.1 | The gateway runs the sign-in flow described below. |

**OAuth flow.** Follows the MCP authorization spec:

1. The user adds a server by URL. The gateway calls it; a `401` with a `WWW-Authenticate` header points to the server's protected resource metadata (RFC 9728).
2. The gateway reads the metadata, finds the authorization server, and fetches its metadata (RFC 8414).
3. If the server supports dynamic client registration (RFC 7591), the gateway registers itself. If not, the user pastes a client ID and secret in the web UI.
4. The gateway opens the user's browser at the authorization URL, with PKCE and a `resource` parameter (RFC 8707) so the token is bound to that server.
5. The provider redirects to the gateway's local callback (`http://localhost:<port>/oauth/callback`). The gateway exchanges the code for tokens and stores them in the vault under the account.

Each account signs in separately, so "work Linear" and "personal Linear" hold different tokens.

**Token lifecycle.**

- Access tokens refresh shortly before they expire, in the background, so calls do not wait on a refresh.
- Rotated refresh tokens replace the old one atomically in the vault.
- A refresh that fails (revoked, expired, scopes changed) marks the server as "sign-in needed". Its tools drop out of search results so the model does not pick them, and the web UI shows a "Sign in again" button.
- The gateway never asks the model or the client to handle a sign-in.
- Signing out revokes the token at the provider where supported, then deletes it from the vault.

**Health.** The web UI shows each remote server's state: connected, sign-in needed, unreachable, or quarantined (changed tools). The gateway re-fetches tool lists on reconnect and on `tools/list_changed`, then re-checks pinned hashes.

**Network.** Remote calls must use HTTPS. Plain HTTP is allowed only for `localhost` and private addresses the user marks as trusted. The gateway can route remote traffic through a proxy the user sets.

## Privacy features

### PII masking with re-hydration

The gateway can replace personal data in tool results with stable placeholders before the model sees them:

```
Before:  "Reply from Jane Doe <jane.doe@acme.com>, phone +1 613 555 0142"
After:   "Reply from [PERSON_1] <[EMAIL_1]>, phone [PHONE_1]"
```

The gateway keeps the mapping in memory for the session. When the model later calls a tool with `[EMAIL_1]` as an argument, the gateway puts the real address back before forwarding. The model can still reason about and act on the data. The provider never receives it.

- **Detection.** Starts with pattern matching (emails, phone numbers, card numbers, IBANs, national ID formats, IP addresses) and checksums where they exist. A small local NER model adds names, organisations and addresses. Everything runs on the machine.
- **Levels.** Per profile: `off`, `standard` (contact details, financial and government identifiers), `strict` (adds names, organisations and addresses).
- **Scope.** The mapping lives for one session and is never written to disk unless the user enables it. Placeholders carry a per-run tag (`[EMAIL_1_k7qx]`, shortened above), so one from before a restart cannot restore a different value.
- **Exceptions.** Per server or per field, for data the model needs in clear (for example the user's own name).
- **Limits.** Masking cannot catch everything. Free-text detection misses some names and catches some false positives. It reduces exposure; it does not guarantee anonymity. The docs and the UI must say so.

### Secret scanning

Tool results are scanned for API keys, tokens, private keys and connection strings, using the same rule sets as common secret scanners. Matches are redacted outright, with no re-hydration. Arguments sent to servers are scanned too, so a model cannot be tricked into sending a stored secret out through a tool call.

### Tool pinning

When a server is added, the gateway records a hash of each tool's name, description and schema. If a server later changes a description, the changed tool is quarantined: hidden from search until the user reviews the diff and approves it. This blocks "rug pull" changes, where a trusted server starts shipping new instructions to the model.

### Data-flow rules

Some combinations of tools are risky together: one that reads private data, one that reads untrusted content, and one that can send data out. The gateway sees every call in a session, so it can track this.

- Each server gets a trust level: `local`, `private-data`, `external-content`, `can-send`.
- Rules are written against those levels, for example: "after a result from an `external-content` server, calls to `can-send` tools need approval for the rest of the session."
- Cross-profile flows are impossible by construction: a client connected to `personal` cannot reach `work` tools.

### Approvals

The client sees one connector, so its own per-tool approval cannot tell tools apart. Approval moves into the gateway:

- by tool, by server, or by the MCP `readOnlyHint` / `destructiveHint` annotations
- triggered by data-flow rules
- answered in the web UI (pending approvals page, optional browser notification), or through MCP elicitation where the client supports it, with a CLI prompt as fallback

### Local activity log

- Records each search and call: time, profile, tool, policy decisions, what was masked and how long it took.
- Argument and result values are excluded by default.
- Stored encrypted, with a retention period the user sets (default 30 days).
- Browsable in the web UI; exportable as JSON lines.

### Process isolation

Downstream stdio servers run as child processes with a reduced environment: only the variables they are configured to receive. The Docker edition can run each server in its own container with no network beyond what it declares. The Mac edition can use the macOS sandbox for servers that support it.

Remote servers get only the token for their own `resource`. A token issued for one server is never sent to another, even within a profile.

### What leaves the machine

The gateway itself makes no outbound connections except:

- to downstream MCP servers the user configured, local or remote
- to the OAuth authorization servers of those remote servers, for sign-in, token refresh and revocation
- to the public directory, only when the user browses it

There is no telemetry, update ping or crash reporting unless the user turns it on.

## Web UI

The gateway serves a management interface at `http://localhost:<port>/`, from the same process. No separate install, no cloud. It is the main interface until a native app exists.

### What it does

- add, remove and test servers: paste a command for a local server or a URL for a remote one
- import servers from existing client configs (Claude Desktop, Claude Code, VS Code and other coding agents)
- sign in to remote servers, see token status, sign out
- add and rotate API keys; values are write-only and never shown again
- create and switch profiles
- set the privacy level per profile and preview masking on a sample result
- approve pending calls and review quarantined tool changes as a diff
- browse and filter the activity log
- copy connection details for Claude or another client

### Access and security

The UI controls every credential, so it gets its own protection, all local:

- **Localhost only.** Binds to `127.0.0.1` by default. Listening on another interface needs an explicit setting and forces a password.
- **Optional password.** Off by default on a single-user machine; one switch in settings or a CLI flag to turn it on. Stored as an Argon2id hash in the local config. No account, no email, no recovery service. Reset by CLI on the machine (`gateway ui reset-password`).
- **Sessions.** `HttpOnly`, `SameSite=Strict` cookie, idle timeout, sign-out from the UI.
- **Request checks.** CSRF tokens on every change. `Host` and `Origin` headers checked to block DNS rebinding and cross-site requests from pages open in the same browser.
- **Re-confirm for sensitive actions.** Deleting a profile, exporting the log or changing the bind address asks for the password again when one is set.
- **Separate from the MCP endpoint.** The UI and the MCP front door use different auth. A client token cannot open the UI, and a UI session cannot call tools.
- **No external assets.** The UI ships its scripts, styles and fonts inside the binary. Opening it makes no outbound request.

## Editions

### Binary and Docker (now)

One binary that runs the gateway, the MCP endpoint and the web UI. Also packaged as a container: the user mounts a config and a data volume and maps one port. Secrets are encrypted in the local database; the key sits in the OS keychain natively and comes from a host secret in Docker. A CLI covers everything the UI does, for scripting.

### Desktop edition (later)

A small native Mac app in the menu bar, likely Swift around the shared core. It starts the gateway at login, shows status and approval prompts as notifications, and opens the web UI in a window. A native app can come later without rebuilding the interface.

All editions share the same core and the same registry format, so a user can move between them.

### Public directory (optional)

We will not run a hosted gateway. Holding other people's credentials and traffic conflicts with the principles above.

A public directory may still help: a read-only catalogue of known MCP servers with descriptions, install details, required credentials and suggested trust levels. The local app browses it and copies entries into the local registry. The directory stores no user data, needs no account and logs no queries. It should draw on the official MCP registry rather than duplicate it.

## Threat model

| Threat | Mitigation |
|---|---|
| Model provider reads personal data in tool results | PII masking with re-hydration |
| Prompt injection in a tool result triggers data exfiltration | Data-flow rules, approvals, secret scanning on arguments |
| Server changes tool descriptions after approval | Tool pinning and quarantine |
| Credentials leak from config files | Encrypted vault, key in the OS keychain; no secrets in the registry file |
| Credentials leak through the model | Credentials injected after the model; never in context |
| One profile's data reaches another | Separate endpoints and client tokens per profile; accounts bound to profiles |
| Malicious or buggy local server reads the environment | Reduced environment, optional container or sandbox |
| Another local process calls the gateway | Gateway binds to localhost and requires a token |
| A web page in the user's browser drives the web UI | CSRF tokens, `Origin` and `Host` checks, `SameSite=Strict` cookies |
| Someone else on the machine or network opens the web UI | Localhost bind by default; password required for any other interface |
| OAuth code intercepted on the local callback | PKCE, `state` check, callback bound to localhost |
| A token for one remote server is replayed to another | Resource-bound tokens (RFC 8707); tokens sent only to their own server |
| Stale or revoked token breaks a task silently | Background refresh, "sign-in needed" state, tools hidden from search until fixed |
| The log becomes a target | Values excluded by default, encrypted at rest, retention limit |

Out of scope: a compromised host machine, a compromised OS keychain, and attacks on the model provider itself.

## Non-goals

- Hosting MCP servers or user credentials.
- Team or enterprise governance (SSO, RBAC, billing). Other gateways cover this.
- Replacing a client's own tool search. The gateway works alongside it and adds portability, profiles and privacy controls.
- Guaranteed anonymisation. Masking lowers exposure and says so plainly.

## Trade-offs

- **Extra step.** The model must search before calling. Search quality decides whether the gateway feels helpful or clumsy.
- **Masking costs accuracy.** A model working with `[PERSON_1]` can make mistakes it would not make with real names, such as mixing up two people. `strict` will not suit every task.
- **Latency.** Local NER adds time to every result. Detection must be fast enough to stay unnoticed on short results.
- **Single point of trust.** One local process holds every credential and sees every result. Its code must stay small and auditable.
- **Client controls move.** Per-tool approval in the client sees one connector, so users must learn the gateway's approvals instead.

## Roadmap

| Phase | Scope |
|---|---|
| 0.1 Core | Registry, profiles, stdio and Streamable HTTP connectors, API key and header auth, `search_tools` / `call_tool`, BM25 search, keychain vault, CLI, Docker image |
| 0.2 Web UI and OAuth | Web UI with optional password, OAuth 2.1 sign-in with discovery and dynamic registration, background refresh, server health, import from client configs |
| 0.3 Privacy | Pattern-based PII masking with re-hydration, secret scanning, tool pinning, local log |
| 0.4 Policy | Trust levels, data-flow rules, approvals in the web UI, read-only mode |
| 0.5 Smarter | Local NER for names and addresses, local embeddings for search, public directory, Mac menu bar app |

## Open questions

- Decided in [Design](design.md): one URL per profile, plus an All profile. Runtime: TypeScript on Bun.
- Should search return full schemas, or names first and schemas on request?
- How to rank tools well with no network access and a small local model?
- Approval rules: per tool, per server, or by read and write hints? (Lean: annotations as the default, per-tool overrides.)
- Which local NER model is small and fast enough, and in how many languages?
- OAuth providers without dynamic client registration: ship pre-registered client IDs for common services, or always ask the user for their own?
- Fixed local port for the OAuth callback (some providers require an exact redirect URI), or a range the user registers?
- Web UI password: off by default on a single-user Mac, or on by default everywhere?
- Web UI stack: server-rendered HTML with a little JavaScript, or a small SPA embedded in the binary?
- Should masking placeholders carry hints (`[PERSON_1, Acme]`) to reduce model confusion, at some privacy cost?
- Core language: Go or Rust for a single static binary the Swift app can embed, or TypeScript for reuse of the official MCP SDK?
- Which existing registries should the public directory draw from?
- Windows and Linux desktop editions, or Mac first only?

## Prior art

- **MetaMCP.** Namespaces and endpoints close to our profiles; flattens all tools into one list.
- **Docker MCP Gateway.** Profiles, container isolation, local secret store; OAuth shared across profiles.
- **mcpproxy-go.** Local proxy with BM25 tool filtering and quarantine of changed tools.
- **dhis2w-mcp-router.** The two-tool search and call pattern, with read-only mode.
- **Microsoft Presidio** and similar libraries. PII detection and anonymisation, outside the MCP context.
- **Lethal trifecta / CaMeL research.** Framing for data-flow rules: private data, untrusted content and an exfiltration channel in one session.

None combines account-scoped secrets, purpose-based profiles, local-only storage, search-based discovery and local PII masking in one small tool. That is the gap this project fills.
