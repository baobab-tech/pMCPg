---
title: Why is this account not working?
summary: Pick an account and pMCPg reads its state, explains it in plain words and offers the fix.
group: troubleshooting
order: 1
---
{{live:account-doctor}}

## What the states mean

| State | Meaning | Usual fix |
|---|---|---|
| Connected | Working | Nothing |
| Idle | Not running right now. Starts when an AI app needs it | Nothing |
| Sign-in needed | The service no longer accepts the saved sign-in or key | [Sign in again](help:sign-in-needed) |
| Can't reach | The server didn't answer or didn't start | [A server won't start](help:server-wont-start) |
| Error | The server stopped or sent an error | [A server won't start](help:server-wont-start) |

While an account isn't working, its tools are hidden from the AI, so the AI doesn't pick tools that would fail.

## The AI can't see a tool, but the account is connected

- Check the AI app uses a profile that holds this account. The panel above lists the account's profiles.
- The tool may be waiting in [Tool review](/quarantine/), or blocked by a profile's read-only switch or rules.
- Start a new chat. Some apps remember the tool list from the start of a chat.
