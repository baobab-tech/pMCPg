---
title: Connect Claude Desktop
summary: Add pMCPg to the Claude app on Mac or Windows, in one click.
group: connect
order: 1
---
{{live:connect-app claude-desktop}}

## How it works

Claude Desktop starts its tools as local commands. pMCPg adds one entry to Claude's settings file that runs `pmcpg connect <profile>`. That command relays Claude to pMCPg and reads the profile's token from the keychain, so the token never sits in Claude's file.

## Steps

1. Click **Connect Claude Desktop** above.
2. Check what will change. pMCPg saves a backup of the file first.
3. If you imported servers from Claude Desktop, tick them under "Remove entries pMCPg now provides". Otherwise Claude sees each tool twice.
4. Quit Claude Desktop fully and open it again.

## Check it works

Ask Claude something that needs one of your tools. It should search pMCPg's tools, then call one. The call shows on the [Activity](/activity/) page.

## Notes

- Connectors you added on claude.ai are separate and keep working. pMCPg can't use them: see [ChatGPT, claude.ai and Gemini](help:cloud-apps).
- To use a different profile, pick it above before connecting. Each profile gets its own entry.
