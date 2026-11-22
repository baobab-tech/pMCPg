---
title: Copy a connector's URL from Claude
summary: Find the server address of a Claude connector and add it to pMCPg. Shown with Figma.
group: servers
order: 5
---
Use this for one connector at a time, or when Claude didn't know an address while [listing your connectors](help:move-claude-connectors).

## In Claude Desktop

1. Click **+** under the message box, then **Plugins**, then **Manage plugins**.

{{diagram:claude-manage-plugins}}

2. Choose **Connectors** at the top, then the connector you want to move.
3. Open the arrow at the end of its row. Next to **Connector URL**, click **Copy server URL**.

{{diagram:claude-copy-url}}

No **Connector URL** row? It's built into Claude and can't move.

## In pMCPg

1. Open [Servers](/servers/?add=1) and choose **Add a server**.
2. Paste the URL and choose **Check**.
3. If it says **Needs sign-in**, you sign in once in your browser, like in Claude.

Then [switch Claude to pMCPg](help:move-claude-connectors) so each tool shows once. More on adding servers: [Add a server by URL](help:add-server-by-url).
