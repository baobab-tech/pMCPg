---
title: Where your keys are stored
summary: Keys and sign-ins are encrypted on this computer, with one master key in the system keychain.
group: security
order: 1
---
{{live:key-source}}

## On this computer only

Every API key, sign-in token and profile token is stored encrypted (AES-256-GCM) in pMCPg's database, `state.db`, in its data folder:

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/Private MCP Gateway` |
| Windows | `%APPDATA%\Private MCP Gateway` |
| Linux | `~/.config/private-mcp-gateway` |
| Docker | `/data` |

## The master key

One master key unlocks them all. It lives in your system's keychain: macOS Keychain, Windows Credential Manager, or Secret Service on Linux. On a Mac you approve this once: see [The Mac keychain prompt](help:keychain-prompt). In Docker it comes from a file or environment variable instead: see [Use pMCPg in Docker](help:docker).

## What never holds a key

- `config.yaml`: it lists servers and accounts, never key values.
- The activity log and error messages.
- Your AI app and the AI model. pMCPg adds the key to each call after the AI has made it.
- This page, after you save: key fields are write-only.

## Backups

Copying `state.db` alone isn't enough: without the master key it can't be read. If the master key is lost, sign in again and re-enter your keys.

## Nothing leaves

pMCPg connects only to the servers you add, their sign-in pages, and nothing else. No account with us, no tracking, no update checks.
