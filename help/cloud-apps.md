---
title: ChatGPT, claude.ai and Gemini
summary: Why web AI apps can't use pMCPg yet, and why their connectors can't be imported.
group: connect
order: 5
---
**Not available yet.** ChatGPT, claude.ai and the Gemini app run in their companies' clouds. Their connectors call MCP servers from there, not from your computer, so they can't reach pMCPg at `127.0.0.1`.

## Why their connectors can't be imported

Connectors you added in claude.ai, ChatGPT or Gemini are saved in your account with that company, not on this computer. pMCPg only reads files on this computer, so it can't see them.

To move them into pMCPg, see [Move your Claude connectors](help:move-claude-connectors). For ChatGPT or Gemini, copy each URL from the app's connector settings and [add it by URL](help:add-server-by-url). You sign in again once, in pMCPg.

## What works today

- **Claude Desktop** on Mac and Windows: [connect it](help:connect-claude-desktop). Your claude.ai connectors keep working alongside.
- **Claude Code**, **LM Studio**, **Cursor**, **VS Code**, and other apps that run on your computer.

## What's planned

A later version will let you open one profile to cloud apps through a secure tunnel: off by default, with a clear indicator while it's on, and an automatic time limit.
