---
title: Connect Cursor or VS Code
summary: Add pMCPg to your editor's MCP settings for all your projects.
group: connect
order: 4
---
Both editors start pMCPg as a local command, `pmcpg connect <profile>`. That command reads the profile's token from pMCPg, so the token never sits in the editor's settings.

## Cursor

{{live:connect-app cursor}}

pMCPg adds an entry to `~/.cursor/mcp.json`. Reload Cursor, then check its MCP settings show `pmcpg`.

## VS Code

{{live:connect-app vscode}}

pMCPg adds an entry to your user `mcp.json`. Reload the window, then start the server from the MCP list if VS Code asks.

## Other apps

Apps that can run a command use `pmcpg connect <profile>` too. Apps that only support MCP over HTTP with a custom header use the address and token under **Other apps** on the [Connect](/connect/) page. The token then sits in that app's settings, so treat the file like a password.
