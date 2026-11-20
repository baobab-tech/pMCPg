---
title: Connect Claude Code
summary: Add pMCPg to Claude Code for every project, with one command pMCPg runs for you.
group: connect
order: 2
---
{{live:connect-app claude-code}}

## Steps

1. Click **Connect Claude Code** above.
2. pMCPg runs `claude mcp add` at user scope, so it works in every project. Claude Code then starts `pmcpg connect <profile>` itself; no token is stored in its settings.
3. Start a new Claude Code session and run `/mcp`. You should see `pmcpg` connected.

The `claude` command must be installed and on your PATH.

## By hand

Open **Do it by hand instead** above for the full command. It runs `pmcpg connect <profile>` and holds no token.

## Project servers

Claude Code can also keep servers per project in `.mcp.json`. [Import](/import/) finds those too, and can make one profile per project.
