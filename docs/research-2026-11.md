# Research notes, November 2026

Facts gathered on 2026-11-07 to choose the stack. Figures marked "approx" were not measured.

## MCP spec and SDKs

**Latest spec: 2026-07-28.** Changes that affect a gateway:

- No `initialize` handshake and no `Mcp-Session-Id`. Each request carries protocol version and capabilities in `_meta`.
- New `server/discover`.
- `subscriptions/listen` replaces the GET stream. Clients opt in to `toolsListChanged`.
- Multi round-trip requests (`input_required`) replace server-to-client requests such as elicitation and sampling.
- SSE resumability removed.
- List results carry `ttlMs` and `cacheScope`.
- Required `Mcp-Method` and `Mcp-Name` headers.
- Clients must validate `iss` (RFC 9207) and key stored credentials by the authorization server's issuer.
- Roots, sampling and logging deprecated.

Downstream servers still speak 2025-11-25 and older. A gateway must negotiate both.

**SDK client-side support:**

| SDK | Version (date) | Spec | Stdio | Streamable HTTP | Legacy SSE | OAuth client |
|---|---|---|---|---|---|---|
| TypeScript v2 (`@modelcontextprotocol/client`) | 2.4.0 (2026-10-23) | 2026-07-28 | yes, `cross-spawn`, Windows-safe | yes | yes | full: RFC 9728, DCR, PKCE, refresh, pluggable storage, issuer-keyed |
| Go (`modelcontextprotocol/go-sdk`) | 1.8.0 (2026-09-14) | 2026-07-28 | yes | yes | yes | marked experimental |
| Rust (`rmcp`) | 3.9.0 (2026-11-05) | 2026-07-28 | yes | yes | no | full |
| Swift | 0.12.1 (2026-05-07) | 2025-11-25 | Apple and Linux only | yes | no | bearer only |
| Python (`mcp`) | 2.3.0 (2026-10-02) | 2026-07-28 | yes | yes | yes | yes |

**Distribution trend.** Official registry crawl (preview, includes old versions, so read as ratios): about 60% of entries are remote-only (streamable-http 39k, SSE 1.1k). Packages: npm 15.3k, PyPI 5.2k, OCI 1.7k, mcpb 1.6k. Remote URLs lead, then npx, then uvx, then Docker.

npm weekly downloads: `@modelcontextprotocol/sdk` 88M; `mcp-remote` 1.8M. PyPI `mcp`: 79M weekly.

## Existing gateways

| Project | Language | Relevant features |
|---|---|---|
| mcpproxy-go | Go | BM25 `retrieve_tools` + `call_tool`, quarantine, sensitive-data detection, upstream OAuth. Its README warns that its own tool menu was larger than listing all tools on a 45-tool set. |
| Docker MCP Gateway | Go | Profiles, servers as sibling containers via docker socket, `mcp-find` / `mcp-add` |
| IBM ContextForge | Python | Federation, plugins, user-scoped OAuth |
| MetaMCP | TypeScript | Namespaces and endpoints; OAuth tested only against the 2025-03-26 spec |
| agentgateway | Rust | Federation, OAuth, CEL RBAC |
| mcp-remote | TypeScript | Stdio-to-remote OAuth bridge, refresh, per-server token isolation |

None found that combines reversible PII placeholders with tool search.

## Packaging

| Option | Size | Notes |
|---|---|---|
| Bun `--compile` | ~90–100 MB | Cross-compiles to mac x64/arm64, Windows x64/arm64, Linux glibc/musl x64/arm64 from one machine. Embeds files. |
| Node SEA | ~100–120 MB (approx) | `--build-sea` since Node 25.5; still "active development"; native addons painful |
| Deno compile | ~180 MB measured once | Native addons need self-extracting mode |
| Go / Rust | 10–20 MB / 5–15 MB (approx) | No JIT entitlements needed on macOS |

**Docker.** Distroless static about 2 MB base. Node images about 140–155 MB. An image that runs npx and uvx servers needs Node, Python and uv: about 300–500 MB. Mounting the docker socket gives root on the host.

**Signing.**

- macOS needs a Developer ID ($99/yr), hardened runtime and notarization. Bun binaries need the JIT entitlements listed in Bun's codesign guide.
- Windows: Azure Artifact Signing covers organisations in US/CA/EU/UK, and individuals only in US/CA; new onboarding has been restricted since April 2025. Fallback is an OV certificate on an HSM, about $200–500/yr. SmartScreen reputation builds over time.

**OS secret storage.**

- `Bun.secrets` uses Keychain, Credential Manager or libsecret, with no add-on. Its docs say the API may change.
- Headless Linux and Docker have no Secret Service, so those need a file or environment backend.

## Libraries

- **Search:** MiniSearch 7.2 (MIT, zero dependencies, BM25-like). Orama 3.1 (Apache-2.0, BM25 plus vectors). bleve (Go). tantivy (Rust).
- **Embeddings:** transformers.js 4.3 on onnxruntime-node (about 300 MB unpacked across all platforms; prune per platform). Ollama or LM Studio over HTTP. Model sizes: all-MiniLM-L6-v2 23 MB int8; bge-small 34 MB int8; EmbeddingGemma 197–309 MB quantized (Gemma licence).
- **PII:** Presidio is Python only. Usable models:
  - OpenAI Privacy Filter: Apache-2.0, about 800 MB q4, mostly English.
  - GLiNER-PII (knowledgator): Apache-2.0, 197 MB int8.
  - piiranha is CC-BY-NC-ND, so not usable.
- **Existing MCP PII proxies:** small and unproven.
- **Secrets:** gitleaks `config/gitleaks.toml` (MIT, 222 rules, plain data). trufflehog is AGPL; do not embed it.
- **Argon2id:** `Bun.password` (PHC output), Node `crypto.argon2` since 24.7, Go `x/crypto/argon2`, Rust `argon2`.
- **Web UI:** Hono (MIT) has JSX server rendering. htmx 2 is about 16 KB gzipped. Bun embeds assets in the compiled binary.

## Windows spawning pitfalls

- Node rejects `npx.cmd` without a shell since CVE-2024-27980. `cross-spawn`, which the TS SDK uses, handles it.
- npx and uvx start a grandchild process. Killing the wrapper leaves orphans. Use Job Objects on Windows and process groups on Unix.
- Apps launched from a GUI do not inherit the shell PATH (nvm, pyenv, uv). Resolve absolute paths or read the login shell's environment.
- First-run npx/uvx downloads need a long start timeout. Anything a server writes to stdout that isn't a protocol message breaks the connection.
