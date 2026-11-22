---
title: Add a server by URL
summary: Paste a server's web address; pMCPg works out how it signs in.
group: servers
order: 1
---
Most online MCP servers give you one web address, often ending in `/mcp`. The service's docs or its "connect to Claude" page usually list it.

## Steps

1. Open [Servers](/servers/?add=1) and choose **Add a server**.
2. Paste the URL. pMCPg contacts the server the same way Claude does and tells you what it needs:
   - **No sign-in needed.** Add it and you're done.
   - **Sign in.** You sign in once on the provider's page in your browser, like any app.
   - **Needs a key.** Paste the API key from the service. It's stored encrypted and never shown again.
3. Pick a short name. It shows up in tool names, like `linear__create_issue`.

New servers join the **All** profile. Add them to other profiles from [Profiles](/profiles/).

## Tools that run on this computer

Some servers are a command instead of a URL, such as `npx -y some-server` or `uvx some-server`. Choose **Add by command instead** and paste it. These need Node.js or uv installed: see [“npx” or “uvx” not found](help:npx-uvx-not-found).

## Already set up somewhere else?

If your AI app already has servers, [import them](help:import-from-ai-apps) instead of retyping.

## Looking for a list of servers?

A searchable catalog of MCP servers is coming soon. For now, add a server by its URL or import it from your AI apps.

## If it fails

“Couldn't reach a server at that address” means nothing answered as an MCP server. Check the URL is complete, including `https://` and the path. A web page address (the service's home page) won't work.

Some providers don't let apps register themselves. pMCPg then asks for a client ID, and sometimes a client secret, from the provider's developer settings.
