# Roadmap

Top ideas first, then what is done, next and later. Edit this file when a plan starts, ships or changes. Suggestions: [open an issue](https://github.com/baobab-tech/pMCPg/issues).

Status words: **planned** (designed, will be built), **exploring** (plan drafted, design open), **idea** (no plan yet).

## Top ideas

| # | Idea | Status | Plan |
|---|---|---|---|
| 1 | **Skills.** Install an Agent Skill once and use it from every AI app, per profile, reviewed and pinned like tools | Exploring | [plans/skills](plans/skills.md) |
| 2 | **Catalog.** Find and add servers in one click, with presets, including a collection for social impact organisations. 0.1 ships with it off ("Coming soon") | Planned | [catalog](catalog.md) |
| 3 | **Cloud AI apps.** Use your gateway from ChatGPT, claude.ai and Gemini through an opt-in tunnel with OAuth | Planned | [plans/cloud-clients](plans/cloud-clients.md) |
| 4 | **Private files.** Give the AI a file without uploading it; it reads a masked copy through pMCPg | Exploring | [plans/vault-drop](plans/vault-drop.md) |
| 5 | **Menu bar app and signed installers.** Status, approvals and Pause in the menu bar; downloads that macOS and Windows trust. Signing needs certificates | Planned | [plans/onboarding-v2: Tray](plans/onboarding-v2.md#tray--menu-bar-not-built), [DESIGN: Distribution](design.md#distribution) |
| 6 | **Update check.** A banner when a new version exists, with no tracking | Planned | [plans/update-check](plans/update-check.md) |
| 7 | **Better masking.** Names and addresses caught by local PII models (light CPU or accelerated tier), and PII hidden in encoded text (PRV-5) | Exploring | [DESIGN: Privacy layer](design.md#privacy-layer) |
| 8 | **Fewer approval prompts.** "Always allow this tool" on an approval | Idea | [policy](policy.md) |

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
| First tagged release, v0.1.0: GitHub Releases archives, install scripts, GHCR images | [DESIGN: Distribution](design.md#distribution) |

## Next

| Item | Plan | Status |
|---|---|---|
| Trust controls in the UI and onboarding, trust suggestions in the catalog (POL-1) | [security registry](security-registry.md) | Planned |
| Release gate: `release` environment with reviewers, `v*` tag ruleset, immutable releases (SUP-2) | [releasing](releasing.md) | Planned |
| npm package and Homebrew formula published on every release (the release workflow has both steps) | [DESIGN: Distribution](design.md#distribution) | Planned |
| Reset masking session from the UI and CLI (PRV-4) | [privacy](privacy.md) | Planned |

## Later

| Item | Plan | Status |
|---|---|---|
| Process sandboxing for stdio servers, so they cannot read the master key or `state.db` (VLT-1) | [security: Stdio servers](security.md#stdio-servers) | Exploring |
| Owner-only file ACLs on Windows when `PMCPG_HOME` is outside `%APPDATA%` (VLT-2) | [security registry](security-registry.md) | Planned |
| Open low-severity findings: CON-3, LOG-1, STD-1, VLT-4 | [security registry](security-registry.md) | Planned |
| Embeddings for tool search, if keyword search proves weak | [DESIGN: Search](design.md#search) | Exploring |
| Client ID metadata document (CIMD) for providers without dynamic registration | [DESIGN: Onboarding](design.md#onboarding) | Exploring |

## Ideas

Add new ideas here with one line each; give them a plan file in `docs/plans/` once they are worth designing.

- Direct tool listing for small profiles instead of `search_tools` ([DESIGN: Open questions](design.md#open-questions))
- Verified self-update for direct downloads ([plans/update-check](plans/update-check.md))
- Skills from downstream MCP servers, passed through with digest checks ([plans/skills](plans/skills.md))
