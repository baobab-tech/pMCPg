---
title: Move your Claude connectors
summary: Claude keeps connectors in its cloud, so you bring each one over once. Copy each connector's URL from Claude's settings and paste it into pMCPg.
group: servers
order: 4
---
Connectors you add in Claude are saved in your Claude account, in Anthropic's cloud. They aren't in a file on this computer, and Claude has no export, so pMCPg can't import them by itself. You bring each one over once.

## Copy each URL from Claude

1. In Claude Desktop, click **+** under the message box, then **Plugins**, then **Manage plugins**.

{{diagram:claude-manage-plugins}}

2. Choose **Connectors** at the top, then the connector you want to move.
3. Open the arrow at the end of its row. Next to **Connector URL**, click **Copy server URL**.

{{diagram:claude-copy-url}}

No **Connector URL** row? It's built into Claude and can't move.

## Add it to pMCPg

1. Open [Servers](/servers/?add=1) and choose **Add a server**.
2. Paste the URL and choose **Check**, then **Add and sign in**.
3. Sign in once in your browser, like in Claude.

Repeat for each connector.

## Switch Claude to pMCPg

1. [Connect Claude Desktop](help:connect-claude-desktop) to pMCPg. **pmcpg** then shows in Claude under **+** → **Plugins**.
2. In the same list, turn off each connector you moved. Keep **pmcpg** on, so each tool shows once.

{{diagram:claude-turn-off}}

## What stays in Claude

- Rows marked **Built-in integration · By Anthropic** are part of Claude. They have no connector URL, so they can't move. Keep them on in Claude.
- claude.ai in the browser can't reach pMCPg yet. Connectors you keep there still work: see [ChatGPT, claude.ai and Gemini](help:cloud-apps).
