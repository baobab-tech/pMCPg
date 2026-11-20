# Roadmap

What is done, what is next, and where each plan lives. Edit this file when a plan starts, ships or changes.

## Done

| Item | Plan |
|---|---|
| Core: config, vault, servers, accounts, profiles, local and remote connectors, `search_tools` / `call_tool`, stdio bridge, CLI, Docker `slim` / `full` | [DESIGN](design.md), [build plan](build-plan.md) |
| OAuth sign-in with background refresh | [DESIGN: Downstream connections](design.md#downstream-connections) |
| Vault: one master key in the OS keychain, secrets encrypted in `state.db` | [DESIGN: Vault](design.md#vault) |
| Privacy tier 0: pattern masking with re-hydration, secret scanning | [privacy](privacy.md), [privacy research](privacy-research.md) |
| Policy presets, custom rules, approvals | [policy](policy.md) |
| Tool pinning and quarantine, encrypted activity log | [CONCEPT: Privacy features](concept.md#privacy-features) |
| Web UI with first-run flow and optional password | [DESIGN: Web UI](design.md#web-ui) |
| Onboarding backend: URL probe, import from AI apps, connect apps, universal `/mcp` | [DESIGN: Onboarding](design.md#onboarding) |
| Onboarding v2: two-path first run, "You're set" screen, Home checklist from real state, Simple / Advanced view with Connections | [plans/onboarding-v2](plans/onboarding-v2.md) |
| Tools without annotations count as destructive (MCP spec default), so `balanced` asks before them | [policy](policy.md#limits) |

## Next

| Item | Plan | Status |
|---|---|---|
| First tagged release (0.1): GitHub Releases archives, GHCR. Signed downloads, npm, Homebrew follow | [DESIGN: Distribution](design.md#distribution) | Signing needs certificates |
| Update check | [plans/update-check](plans/update-check.md) | Planned |
| Public catalog with presets, including a collection for social impact organisations. 0.1 ships with the catalog off: the web UI shows "Coming soon" and `pmcpg catalog search` makes no request | [catalog](catalog.md) | Coming soon, after 0.1 |

## Later

| Item | Plan |
|---|---|
| Cloud AI apps: ChatGPT, claude.ai, Gemini (tunnel + OAuth on the front door) | [plans/cloud-clients](plans/cloud-clients.md) |
| PII model tiers (light CPU model, accelerated model) with a hardware probe | [DESIGN: Privacy layer](design.md#privacy-layer) |
| Embeddings for tool search, if keyword search proves weak | [DESIGN: Search](design.md#search) |
| Client ID metadata document (CIMD) for providers without dynamic registration | [DESIGN: Onboarding](design.md#onboarding) |
| Native menu bar / tray: status dot, Open, approvals count, Pause / Resume, Quit | [plans/onboarding-v2: Tray](plans/onboarding-v2.md#tray--menu-bar-not-built) |

## Ideas

Add new ideas here with one line each; give them a plan file in `docs/plans/` once they are worth designing.

- Direct tool listing for small profiles instead of `search_tools` ([DESIGN: Open questions](design.md#open-questions))
