---
title: Export and import your server list
summary: Save your servers to a file for a backup, another AI app, a new computer or your team. Keys are never in the file.
group: servers
order: 6
---
On [Connections](/servers/), **Export** saves your server list to a file. On [Import](/import/), **From a file** reads one back.

## Export

1. Click **Export**.
2. Pick the app the file is for. The first choice works for Claude Code, LM Studio, Windsurf and most other apps.
3. Click **Download**, or **Copy** to paste it into the app's settings.

Turn on **For sharing** before you send the file to someone. It leaves out your account names and your home folder, and lists each server once.

## What the file holds

- Server names, commands and web addresses.
- The **names** of the keys each server needs, written as `${NAME}`. Never the keys themselves.
- Servers you sign in to through the browser appear with their address only. The app that imports them asks you to sign in.

The **pMCPg** format is for another copy of pMCPg: it keeps each account as its own entry.

## Import a file

1. Open [Import](/import/) and click **From a file**.
2. Pick the file. Online servers are ticked for you.
3. Tick servers under "On this computer" only if you trust whoever sent the file: each one runs a program on your computer.
4. Click **Import**, then fill in keys and sign in on the list that follows.

Any export format works, and so do other apps' settings files. Servers you already have show as "Already added".

## Good to know

- Claude Desktop's file can't hold online servers. Add those in Claude Desktop under Settings, Connectors, or see [Move your Claude connectors](help:move-claude-connectors).
- Keys stay encrypted on this computer. See [Where keys are stored](help:where-keys-are-stored).
