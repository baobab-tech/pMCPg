---
title: Servers, accounts and profiles
summary: The three things you set up in pMCPg, and how they fit together.
group: getting-started
order: 3
---
{{diagram:objects}}

## Server

Where tools come from. Either a **web address** for an online service, or a **command** for a tool that runs on this computer. A server holds no keys.

## Account

One sign-in to one server. "Gmail, work" and "Gmail, personal" are two accounts on the same server, with separate keys that never mix.

Adding a server creates its first account. Add more on the [Accounts](/accounts/) page.

## Profile

A named set of accounts for one purpose, with its own address and token. An AI app connects to one profile and sees only that profile's accounts. It cannot switch to another profile.

The built-in **All** profile holds every account. Use it if you want one connection for everything.

Each profile also has its own privacy level and approval preset.

## In short

| | Holds | Example |
|---|---|---|
| Server | How to reach it | `https://mcp.example.org/mcp` |
| Account | Keys and sign-in | `gmail-work` |
| Profile | A list of accounts, an address, rules | `briefing` |

More: [Profiles](help:profiles), [Work and personal accounts](help:multiple-accounts).
