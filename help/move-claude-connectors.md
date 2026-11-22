---
title: Move your Claude connectors
summary: Claude keeps connectors in its cloud, so you bring each one over once. The fastest way is to let Claude list them.
group: servers
order: 4
---
Connectors you add in Claude are saved in your Claude account, in Anthropic's cloud. They aren't in a file on this computer, and Claude has no export, so pMCPg can't import them by itself. You bring each one over once.

## Let Claude list them

1. Open [Import](/import/) and choose **Ask your chatbot to list them**. Click **Copy to clipboard**.
2. Start a new chat in Claude with your connectors turned on. Paste the message and send it. Claude answers with a list in a code block.
3. Paste the whole answer under **2. Paste the answer here** and choose **Find servers**.
4. Tick the ones to add. Then sign in to each one, once, on [Accounts](/accounts/).

Only names and web addresses are read from the answer. A row marked **URL needed** means Claude didn't know the address: [copy it from Claude's settings](help:copy-connector-url).

## Switch Claude to pMCPg

1. [Connect Claude Desktop](help:connect-claude-desktop) to pMCPg. **pmcpg** then shows in Claude under **+** → **Plugins**.
2. In the same list, turn off each connector you moved. Keep **pmcpg** on, so each tool shows once.

{{diagram:claude-turn-off}}

## What stays in Claude

- Rows marked **Built-in integration · By Anthropic** are part of Claude. They have no connector URL, so they can't move. Keep them on in Claude.
- claude.ai in the browser can't reach pMCPg yet. Connectors you keep there still work: see [ChatGPT, claude.ai and Gemini](help:cloud-apps).
