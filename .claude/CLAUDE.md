# pMCPg: working rules

Private MCP Gateway. Read `docs/design.md` before changing code; `docs/concept.md` explains why.

## Principles

Simple and secure. When options conflict, pick fewer moving parts, then the smaller attack surface.

Easy for non-technical users and small teams by default; fully customizable for power users. Presets and plain words first, `config.yaml` and custom rules underneath.

## Stack

- Bun 1.4.4+, TypeScript, compiled with `bun build --compile` into one binary (`pmcpg`).
- Runtime dependencies are fixed: `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/hono`, `hono`, `minisearch`, `zod`. Use Bun built-ins for everything else (`Bun.secrets`, `Bun.password`, `bun:sqlite`, `Bun.YAML`, `Bun.serve`, `bun test`).
- Do not add runtime dependencies. If one seems necessary, stop and ask the main session.
- Exception: the web UI in `ui/` is a separate Next.js + shadcn package (static export, build-time only). Its dependencies live in `ui/package.json` and never reach the gateway's runtime.
- SDK v2 docs: https://ts.sdk.modelcontextprotocol.io/v2/ and the `.d.mts` files in `node_modules/@modelcontextprotocol/*/dist`.

## Contracts

These files define the interfaces between modules. Do not change them in a feature branch; if one needs to change, stop and say what and why.

- `src/core/config.ts`: config schema (zod)
- `src/core/types.ts`: `ToolRef`, `ToolResult`, `AccountState`, `GatewayError`, naming
- `src/vault/vault.ts`: `Vault` and key names
- `src/connectors/connector.ts`: `Connector`, `ConnectorFactory`, `OAuthController`
- `src/search/search.ts`: `ToolIndex`
- `src/pipeline/step.ts`: `CallContext`, `Step`, `runPipeline`
- `src/privacy/detector.ts`: `Detector`
- `src/store/events.ts`: `GatewayEvent`, `EventSink`
- `src/store/db.ts`: database schema (migrations are append-only)
- `src/store/approvals.ts`: `ApprovalStore`
- `src/store/activity.ts`: `ActivityLog`
- `src/pinning/pins.ts`: `PinStore`
- `src/gateway/handle.ts`: `GatewayHandle`, what the web UI's API may read and change

Module-owned schemas (the owning session may extend them, keeping existing fields valid): `src/policy/schema.ts`, `src/privacy/schema.ts`.

## Ownership

Each feature branch touches only its own folder plus its tests in `test/<folder>/`. CLI commands go in `src/cli/commands-<area>.ts`, never in `commands.ts`. Shared fixtures go in `test/fixtures/` with a new file name, never edits to someone else's.

## Security rules

- Secrets never go in `config.yaml`, logs, events, error messages or test snapshots.
- Events carry names, counts and outcomes, never argument or result values. The one exception: `search` events carry the free-text query.
- Bind to `127.0.0.1` by default. Check `Host` and `Origin` on every HTTP route.
- No outbound network calls except to configured servers, their OAuth servers and the catalog.
- Spawn child processes with `shell: false`. Stdio servers get an explicit environment; the browser launcher and the `claude` CLI inherit the full one.

## Checks

Before every commit: `bun run check` (biome + tsc) and `bun test` must pass locally.

No CI runs on GitHub. Builds happen locally, only when the user asks: `bun run ci` (install, check, test, build, `pmcpg version`). The only workflow left is Release, which runs on a `v*` tag push.

## Style

Comments and docs follow the writing style in the user's global instructions: lead with the fact, short sentences, no filler.
