# pmcpg.io: content plan

One page. Dark by default, light supported (follows the OS, toggle in the header). Brand: the gateway UI's teal (`--brand`) and Oxanium headings.

## 0. Header (sticky, blurred)

Logo · How it works · Privacy · Teams · Install · GitHub (star link) · `v0.1.3` badge linking to the latest release.

## 1. Hero

Audience toggle, a sliding segmented switch: **New to connectors** · **I use connectors** · **IT teams**.

| | New to connectors | I use connectors | IT teams |
|---|---|---|---|
| Headline | Let your AI app use your tools, safely. | Set up each connector once. Use it in every AI app. | Decide which connectors your team's AI can use, and what it can do with them. |
| Explanation | Connectors (MCP servers) let Claude or ChatGPT read your email, files and calendar. pMCPg runs on your computer, holds the sign-ins, and masks personal data in what your connectors send back to the AI. | Import the servers you already set up in Claude Desktop, Claude Code, VS Code and LM Studio. Each app then connects once, to pMCPg. Keys live in your keychain, not in JSON files. | Profiles, approval rules, personal data masking and an encrypted activity log, on each machine or in Docker. No cloud service, no account. Org-wide management is coming. |
| CTA | Install (copy the one-line command) · How it works | Install · Import your servers | Self-host with Docker · Read the security model |

Right side: the **3D layer stack**. Three stacked, tilted glass panels:

1. Top: AI apps (Claude Desktop, Claude Code, VS Code, LM Studio).
2. Middle: pMCPg, glowing, with chips `search_tools` · `call_tool` · vault · masking · policy · log.
3. Bottom: MCP servers (Figma, Linear, Research MCP, OpenAlex, DevExplorer…).

The stack plays one real example in 5 steps, with a caption card under it and step bars: Claude Desktop, a Research profile, DevExplorer (IATI aid data) and OpenAlex (papers). A glowing packet travels between the chips: ask → `search_tools` (OpenAlex has no matching tools, so it stays out) → `call_tool` to DevExplorer through policy and keychain → `call_tool` to a custom CRM MCP, contact email masked → answer, activity log records 1 search and 2 calls. The stack tilts with the pointer and spreads apart as you scroll.

Under the hero: install command block with a copy button, OS tabs (macOS/Linux · Windows).

## 2. Before / after

Two side-by-side panels, animated on scroll.

- **Before:** 3 apps × 5 servers = 15 setups, keys copied into each app, expired sign-ins.
- **After:** 3 apps → 1 gateway → 5 servers. One sign-in per account.
- Counter (odometer): tools the AI sees up front, "hundreds" → **2**.

## 3. How it works (changes with the audience toggle)

Four steps, cards that rise in on scroll.

- **New to connectors:** Install → Add a server (paste a URL, sign in) → Connect your AI app (one click) → Ask your AI.
- **I use connectors:** Install → Import from your apps → Finish sign-ins → Replace each app's entries with one pMCPg entry (backup first).
- **IT teams:** Run on each machine or in Docker → Create profiles per purpose → Pick a policy preset (`open`, `balanced`, `careful`) and privacy level → Review approvals and the activity log.

## 4. One request, step by step

The request flow from `docs/how-it-works.md`, as a scroll-driven sequence:

1. The AI searches for a tool. Only matches come back.
2. The AI calls it. The gateway checks your rules and adds the saved sign-in.
3. The result comes back. `jane@acme.org` becomes `[EMAIL_1]`.
4. The AI replies to `[EMAIL_1]`. The gateway puts `jane@acme.org` back.

Animated email chip that flips between real and masked.

## 5. Features (spotlight cards, bento grid)

- One connection: two tools, any number of servers.
- Keys in your keychain: OAuth sign-in and refresh; the AI never sees a key.
- Personal data masking (Beta): with the honest limit line from the docs.
- Profiles: one URL per purpose; an agent sees only its profile's tools.
- Approvals: allow, ask or block, with one sentence saying why.
- Tool pinning: a changed tool is quarantined until you review it.
- Secret scanning: keys in results or arguments are redacted.
- Activity log: encrypted, values excluded, 30-day default retention.

## 6. What leaves your machine

The table from `docs/privacy.md` (local/cloud model × local/remote servers → what leaves → suggested setup), as a 2×2 interactive grid. Line: "With a local model and local servers, nothing leaves your machine." No telemetry, no update ping, no crash reports.

## 7. For teams and IT (works today / coming)

Two columns.

- **Works today:** profiles with separate URLs and tokens, policy presets and custom rules, approvals, privacy levels per profile, secret scanning, tool pinning, encrypted activity log with JSON-lines export, Docker images (`slim`, `full`) with a master key file and required UI password.
- **Coming (roadmap ideas, self-hosted only):** managed setup through MDM, org policy packs, private org catalog, team gateway on a server, audit export to your log system, keys from your secret manager. Link to the roadmap and to GitHub Issues.

## 8. Works with

Logos/wordmarks as text chips: Claude Desktop, Claude Code, VS Code, LM Studio. Note: claude.ai, ChatGPT and Gemini are on the roadmap (opt-in tunnel); their connectors can be pasted as URLs today.

## 9. Install

Tabs: One line (macOS/Linux, Windows) · npm · Homebrew · Docker (compose snippet). Commands copied verbatim from `docs/install.md`. Note: v0.1 binaries are not code-signed; the one-line installer handles this.

## 10. Footer

Apache 2.0 · GitHub · Docs · Security · Roadmap · "Built by Baobab Tech, with a focus on social impact organizations."

## Components

- shadcn/ui: button, tabs, badge, card, tooltip.
- KeyframeUI: `tilt-card`, `odometer`.
- React Bits: `SpotlightCard` (feature cards), one light background (Aurora or Dark Veil, only if it stays light on the GPU; otherwise a CSS gradient + grid).
- Animate UI: tabs with a sliding highlight, for the audience toggle and install tabs.
- Motion for the layer stack, scroll parallax and reveals. All motion off under `prefers-reduced-motion`.
- Bklit: not used; no chart helps here.

## Examples

Never use Cursor as an example AI app. Use Claude Desktop, Claude Code, VS Code, LM Studio, or well-known open-source MCP apps.

## Privacy claims

Masking covers tool results (and placeholders in tool arguments), not what the user types or pastes into the chat. Never say pMCPg "hides personal data from the AI provider" without that scope.
