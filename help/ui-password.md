---
title: Set a password for this page
summary: Optional on your own computer, required when pMCPg is reachable from other machines or runs in Docker.
group: security
order: 2
---
{{live:password-status}}

This page controls every key pMCPg holds. A password stops others from opening it.

## When you need one

- **Shared computer:** yes. Anyone using your account in a browser could otherwise open it.
- **Your own computer:** optional. Other computers can't reach it: pMCPg listens on `127.0.0.1`, this computer only.
- **Listening on a network address, or in Docker:** required. The first visit asks for a one-time setup code from pMCPg's output, then for a password.

## Set or change it

Open [Settings](/settings/). The password is stored as a one-way hash (Argon2id), never as text.

pMCPg asks for it again before actions that are hard to undo, such as removing an account or changing another app's settings.

## Forgot it

There is no email reset and no recovery service. On this computer, in a terminal, run:

```
pmcpg ui reset-password
```

Your servers, accounts and keys are untouched.

## What it doesn't protect

The password protects this page. AI apps use a separate token per profile, which can't open this page. See [Where your keys are stored](help:where-keys-are-stored).
