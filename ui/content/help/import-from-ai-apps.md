---
title: Import from your AI apps
summary: Bring in servers you already set up in Claude Desktop, Claude Code, LM Studio, Cursor or VS Code.
group: servers
order: 2
---
[Import](/import/) looks at the settings files of the AI apps on this computer and lists the servers it finds. You pick which ones to bring in.

## What is read

- Names, commands and web addresses of servers.
- The **names** of the keys each server uses, never their values. Each key shows as "needs a value", and you type it once in pMCPg.
- Keys that sit inside a URL (like `?api_key=…`) are taken out of the address and stored encrypted.

Import only reads. It never changes your apps' files.

## After import

1. Sign in to the servers that need it, and fill in missing keys, on [Accounts](/accounts/).
2. [Connect your app](/connect/) to pMCPg. pMCPg offers to remove the imported entries from the app, so each tool doesn't show up twice.

## Good to know

- The same server found in several apps appears once, with a list of where it was found.
- `npx mcp-remote <url>` entries become plain online servers.
- Entries that already point at pMCPg are skipped.
- From Claude Code you can make one profile per project.

## Not found?

Connectors added on claude.ai, ChatGPT or Gemini live in those companies' clouds and can't be read from this computer. Paste their URLs instead: see [ChatGPT, claude.ai and Gemini](help:cloud-apps).
