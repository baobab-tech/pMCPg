# Build plan

## Phase 0: base (done 2026-11-07)

- Stack spike passed (removed; see git history for `spike/spike.ts`): SDK v2 client and server, Hono front door, MiniSearch, Bun built-ins, compiled binaries for macOS, Linux and Windows.
- Repo scaffold: Bun, TypeScript, biome, `bun test`, CI on macOS, Windows and Linux.
- Contracts in place (listed in `.claude/CLAUDE.md`), with tests in `test/contracts.test.ts`.
- Fixture: `test/fixtures/echo-server.ts` (stdio server with `echo` and `send_email`).

## Phase 1: parallel, one branch each

| Branch | Scope | Folders |
|---|---|---|
| `p1-state` | Vault (keychain and db backends, backend selection), config load/save with validation, `ALL_PROFILE` resolution, data dir setup | `src/vault`, `src/core` (new files only) |
| `p1-stdio` | Stdio connector: PATH from login shell, `.cmd` shims, env allow list, secret injection, process groups and Job Objects, idle stop, tool cache | `src/connectors/stdio*` |
| `p1-remote` | Remote connector (Streamable HTTP, SSE fallback), `OAuthClientProvider` on the vault, `OAuthController`, background refresh, sign-in-needed state, fake OAuth server fixture | `src/connectors/remote*`, `src/connectors/oauth*` |
| `p1-frontdoor` | `ToolIndex` on MiniSearch, front door server (`/p/<profile>/mcp`, `/mcp`), `search_tools`, `call_tool` through `runPipeline`, client-token auth, `pmcpg connect` stdio bridge | `src/search`, `src/frontdoor`, `src/pipeline` (new files only) |
| `p1-cli-dist` | CLI command parsing and non-`serve` commands, `service install/uninstall`, release workflow (compile matrix, checksums, attestations), Docker `slim` and `full`, npm platform packages, Homebrew formula | `src/cli`, `.github/workflows/release.yml`, `packaging/docker/`, `packaging/npm/`, `packaging/homebrew/` |

Each branch builds against the contracts with fakes for the others, then merges into `main` by pull request.

## Integration (done 2026-11-07)

Wired `pmcpg serve`: config, vault, connector pool, index, front door, pipeline, OAuth callback. End-to-end test with the echo fixture and the fake OAuth server. Tag 0.1.

## Phase 2: parallel

Contracts added first (2026-11-07): `ApprovalStore`, `ActivityLog`, `PinStore`, `GatewayHandle`, policy and privacy schemas, per-area CLI command files.

| Branch | Scope |
|---|---|
| `p2-ui` | Next.js + shadcn static export in `ui/`, embedded in the binary; JSON API and UI auth in `src/api/`; first run, servers, accounts, profiles, connect-a-client |
| `p2-privacy` | Research CPU-friendly detection; tier 0 detectors, placeholders, re-hydration, secret scanning; `pmcpg privacy` CLI with many tests |
| `p2-pinning-log` | `PinStore` (quarantine), encrypted `ActivityLog` with retention, `pmcpg log` and `pmcpg tools review` |
| `p2-policy` | Presets (open, balanced, careful) plus custom rules; `ApprovalStore`; policy step; `pmcpg policy` CLI |

Then integration here: wire steps and stores into `serve`, mount the UI, end-to-end tests, tag 0.2.
