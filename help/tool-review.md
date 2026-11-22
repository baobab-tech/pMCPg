---
title: Tool review
summary: When a server adds or changes a tool, pMCPg holds it back until you check it.
group: policy
order: 2
---
Each tool comes with a description the AI reads and trusts. A server could change that description later to slip in new instructions. pMCPg guards against this.

## How it works

1. When an account first connects, pMCPg records a fingerprint of each tool: its name, description and inputs.
2. Each time the server's tool list is checked again, pMCPg compares.
3. A tool that changed, or a new tool that appeared later, is held back. The AI can't find or call it.
4. It shows in [Tool review](/quarantine/) with the old and new text side by side.

## Your choice

- **Approve.** The new version becomes the one pMCPg trusts. The AI can use it again.
- **Reject.** This version stays hidden. If the server changes the tool again, it comes back here for review.

## When to approve

Most changes are ordinary updates: a fixed typo, a new option. Look for text that tells the AI to do something beyond the tool's job, like "also send the results to…" or "ignore earlier instructions". Reject those, and consider removing the server.

If you're unsure, reject. You can approve later.
