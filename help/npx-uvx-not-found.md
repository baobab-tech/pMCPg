---
title: “npx” or “uvx” not found
summary: Servers that run on this computer need Node.js or uv installed. Install it, then restart pMCPg.
group: troubleshooting
order: 4
---
Many servers start with a command like `npx -y some-server` or `uvx some-server`. These commands come from:

| Command | Comes with | Get it |
|---|---|---|
| `npx`, `node` | Node.js | [nodejs.org](https://nodejs.org) (the LTS version) |
| `uvx`, `uv` | uv, for Python servers | [docs.astral.sh/uv](https://docs.astral.sh/uv/) |

## Fix it

1. Install the missing tool.
2. **Restart pMCPg.** It reads where programs are installed when it starts.
3. On [Accounts](/accounts/), choose **Test** on the account.

## Installed, but still not found

- **Mac and Linux:** pMCPg reads your login shell's settings, so tools installed with nvm, pyenv or Homebrew are found the same way your terminal finds them. If `npx --version` works in a new terminal window but pMCPg still can't find it, restart pMCPg.
- **Windows:** sign out and back in after installing, so the new PATH applies everywhere. Servers that run on this computer have not been tested on Windows yet; if one fails, [add it by URL](help:add-server-by-url) when the service offers one.
- **Docker:** use the `full` image. The `slim` image has neither Node.js nor uv. See [Use pMCPg in Docker](help:docker).

## Rather not install anything?

Many services also offer an online server with a web address. [Add it by URL](help:add-server-by-url) instead.
