---
title: Add a server that runs on this computer
summary: Move a server you start with npx, uvx or another command behind pMCPg.
group: servers
order: 2
---
If your AI app starts a server with a command like `npx -y some-server` or `uvx some-server`, pMCPg can start it instead. Your apps connect to pMCPg once and see every server's tools.

## Steps

1. Open [Servers](/servers/?add=1) and choose **Add a server**, then **On this computer**.
2. Paste the command from the server's instructions, for example `npx -y @modelcontextprotocol/server-filesystem ~/Documents`.
3. If the server needs an API key, choose **API key or token** and paste it. It is stored encrypted. Other environment variables go under advanced options.
4. Choose **Test** on the account. The first start can take a minute while the server downloads.

Already have it in Claude Desktop, Claude Code, Cursor, VS Code or LM Studio? [Import it](help:import-from-ai-apps) instead. Secret values are not copied; pMCPg asks for them again.

## What changes

- pMCPg starts the server the first time a tool is used and stops it after 10 minutes idle. Your AI apps no longer run it.
- Remove the server from each AI app's own config once it works through pMCPg, or you will see its tools twice.
- Its calls get search, [masking](help:masking), [approvals](help:approvals-presets) and the activity log.

## Before you add one

- **It runs as you.** A server on this computer can read the same files you can. Only add servers you would install as a program. See [Security](https://github.com/baobab-tech/pMCPg/blob/main/docs/security.md#stdio-servers).
- **It gets a small environment.** It sees basic system settings plus the values you gave it, not your whole terminal environment.
- **It needs its tools installed.** `npx` needs Node.js and `uvx` needs uv: see [“npx” or “uvx” not found](help:npx-uvx-not-found).
- **No window.** Servers that need to open an app window or a login page of their own may not work.
- **Already running at a local address** like `http://localhost:3000/mcp`? Add it by [URL](help:add-server-by-url).
- **Docker:** use the `full` image. See [Use pMCPg in Docker](help:docker).
- **Windows:** local servers are not tested on Windows yet.
