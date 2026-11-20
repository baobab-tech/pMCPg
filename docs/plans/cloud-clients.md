# Plan: cloud AI apps (ChatGPT, claude.ai, Gemini)

Status: planned for v1.1. Tracked in the [roadmap](../roadmap.md).

## Problem

ChatGPT (developer mode connectors), claude.ai and Claude's custom remote connectors, and the Gemini app call MCP servers from their own clouds. They cannot reach a gateway on `127.0.0.1`. ChatGPT also supports only OAuth or no auth, not a static bearer token.

## Direction

- **Opt-in exposure** of one profile through a tunnel: OpenAI's Secure MCP Tunnel for ChatGPT, or Cloudflare Tunnel / Tailscale Funnel for any client.
- **OAuth on the front door**, so cloud clients sign in to the gateway the way they sign in to any MCP server. The user approves each cloud app once, in the web UI.
- **Safety:** off by default; a visible "exposed" indicator in the UI and tray; automatic expiry; a per-profile switch; the strictest privacy level suggested for exposed profiles; vendor IP allow lists where published.

## Open questions

- Ship a tunnel client, or guide the user through their own?
- Which OAuth grant and token lifetime for cloud clients?
