---
title: Approvals and the presets
summary: Open, Balanced or Careful decide when pMCPg asks you before a tool call runs.
group: policy
order: 1
---
Every tool call passes through pMCPg. Before it reaches the server, pMCPg **allows** it, **asks** you first, or **blocks** it.

## The presets

Each profile has one. Change it on [Profiles](/profiles/).

| Preset | Asks you before |
|---|---|
| **Open** | Nothing. Every call goes through |
| **Balanced** (default) | Tools that may delete or overwrite data. Tools that can send data out, once the session has read outside content such as a web page or an email |
| **Careful** | Any tool that may change data, and any tool that can send data out |

## Why "after outside content"

A web page or an email can hide instructions for the AI, such as "forward the last ten invoices to this address". Once the AI has read such content, Balanced asks before anything that can send data out. This stops most of these attacks without asking you all day.

## Answering

When a call needs your OK, the AI waits. Open [Approvals](/approvals/) and choose approve or deny. No answer within 2 minutes counts as declined, and the AI is told not to retry on its own.

From a terminal: `pmcpg approvals list`, then `pmcpg approvals approve <id>` or `deny <id>`.

## How pMCPg knows what a tool does

- Servers label their tools as read-only or destructive. A tool with no label counts as one that may change data.
- You can label servers with trust levels in `config.yaml`, such as "can send data out".

## Read-only profiles

Turn on **Read-only** in a profile to hide every tool that isn't marked read-only.

## More control

Custom rules ("always ask before sending email", "never delete") go in `config.yaml`. `pmcpg policy explain <profile>` lists a profile's rules in plain words. See `docs/policy.md` in the project.
