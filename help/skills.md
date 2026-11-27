---
title: Skills
summary: Keep instructions for your AI apps in one place and give each profile the ones it needs.
group: profiles
order: 3
---
A skill is a set of instructions an AI app follows for one kind of task, such as writing release notes in your team's format. It is a folder with a `SKILL.md` file, plus any templates or scripts it points to.

pMCPg keeps your skills in one library and serves them to every AI app connected through it.

## Add a skill

1. Open [Skills](/skills/).
2. Choose **New skill** and write the name, when to use it, and the steps. Or choose **Upload a folder** for a skill you already have.
3. The **All** profile gets every skill. For another profile, edit it in [Profiles](/profiles/) and tick the skill.

From the command line: `pmcpg skills add <folder>`, then `pmcpg skills enable <name> --profile <profile>`.

## How AI apps get them

- **Apps that support skills over MCP** (Claude Code and VS Code, both in beta) list them as skills named `pmcpg:<skill>`.
- **Other apps** find them through pMCPg's search, next to your tools.

## Skills from your servers

Some MCP servers publish skills for their own tools. They are off until you turn them on in [Skills](/skills/).

- **Text only** keeps the instructions and drops scripts. Start here.
- **All files** includes scripts. An AI app may run them on your computer, so choose it only for servers you trust.

The first set is trusted when you turn them on. After that, a new or changed skill waits for your review, like changed tools in [Tool review](help:tool-review). AI apps keep the version you approved until you decide.

## What pMCPg never does

- Run a skill's scripts. That is up to your AI app, which should ask you first.
- Fetch skills from the internet. Skills come from your library or from servers you added.
- Log skill content. The [activity log](/activity/) records which skill was read, nothing more.
