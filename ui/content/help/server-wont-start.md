---
title: A server won't start
summary: “Can't reach” or “Error” on an account, and what to check.
group: troubleshooting
order: 3
---
Start with [Why is this account not working?](help:account-not-working): it reads the exact message and suggests a fix.

## Online servers (web address)

- **Check your internet connection.**
- **Check the address.** It should be the server's MCP address, often ending in `/mcp`, not the service's home page.
- **The service may be down.** pMCPg retries by itself. Choose **Test** on the account to try now.
- **Plain `http://`** addresses only work for this computer and private networks you allow. Online servers need `https://`.

## Servers that run on this computer (a command)

- **“command not found”**: Node.js or uv isn't installed, or pMCPg can't see it. See [“npx” or “uvx” not found](help:npx-uvx-not-found).
- **First start is slow.** `npx` and `uvx` download the server the first time. Wait a minute, then test again.
- **“server exited”**: the server started, then quit. Usually a key or setting is missing or wrong. Check the account's **Keys**.
- **See the server's own error.** Run the same command in a terminal. Find it on [Servers](/servers/).

## Still stuck

Remove the account and add the server again, or ask the server's maker. Their error messages appear in the account's state on [Accounts](/accounts/).
