# Plan: update check

Status: planned. Tracked in the [roadmap](../roadmap.md).

## Goal

Tell users when a newer version exists, especially for direct downloads, which have no package manager to do it for them. Without breaking "no telemetry".

## Design

- **What is fetched.** The latest release from the GitHub Releases API (`GET https://api.github.com/repos/baobab-tech/pMCPg/releases/latest`). The request carries no identifier, no install ID, no version in the URL or headers beyond a generic `User-Agent: pmcpg`. GitHub sees the IP address, as with any download.
- **When.** At most once a day, in the background, a few minutes after start. Never blocks start-up.
- **Where it shows.** A banner in the web UI ("Version 0.4.0 is available"), a line in `pmcpg version` and `pmcpg serve` output, and `pmcpg update check` on demand.
- **How to update depends on how it was installed.** The binary records its channel at build time (`download`, `npm`, `homebrew`, `docker`) and the banner shows the matching step:

| Channel | Update step shown |
|---|---|
| Download | Link to the release page; signed installer replaces the binary |
| npm | `npm i -g private-mcp-gateway@latest` (or nothing for `npx`) |
| Homebrew | `brew upgrade pmcpg` |
| Docker | `docker pull ghcr.io/baobab-tech/pmcpg:<tag>` |

- **Off switch.** `updates.check: false` in `config.yaml` and a toggle in Settings. Off by default in Docker (images are updated by the operator) and when `PMCPG_NO_UPDATE_CHECK=1`.
- **Security notices.** Release notes may flag a release as a security fix; the banner then says so.
- **No auto-update in v1.** The gateway never downloads or replaces itself. A later version may add a verified self-update for direct downloads (signature and checksum checked before replacing).

## Open questions

- Show pre-releases to users who opt in?
- Cache the result in `state.db` so the UI shows it after a restart without a new request?
