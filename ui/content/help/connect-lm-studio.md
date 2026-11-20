---
title: Connect LM Studio
summary: Give a local model in LM Studio your tools, with nothing leaving your computer.
group: connect
order: 3
---
{{live:connect-app lm-studio}}

## Steps

1. Click **Connect LM Studio** above.
2. pMCPg adds an entry that runs `pmcpg connect <profile>` to LM Studio's `mcp.json`, after saving a backup. No token is written there.
3. Restart LM Studio, or reload its MCP settings.

## Local model, local data

When the model runs in LM Studio, tool results stay on your computer. Masking isn't needed for privacy then, so a profile used only by LM Studio can use privacy level **Off**. See [Pick a privacy level](help:privacy-levels).

If you also use a cloud AI, give it a different profile with masking on.

## Small models and many tools

pMCPg shows the model two tools, search and call, instead of every tool from every server. This keeps the model's context small, which helps small local models most.
