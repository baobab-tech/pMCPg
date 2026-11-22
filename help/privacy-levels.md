---
title: Pick a privacy level
summary: Off, Standard or Strict, set per profile, and what each one hides.
group: privacy
order: 2
---
**Beta in v0.1.** Masking catches common patterns like emails and phone numbers. It can miss things, so don't rely on it alone for sensitive data.

Each profile has a privacy level. Change it on [Profiles](/profiles/).

| Level | Hides | Use it for |
|---|---|---|
| **Off** | Nothing (secrets are still removed) | A local model, such as LM Studio |
| **Standard** | Emails, phone numbers, card numbers, IBANs, IP addresses, national ID numbers | Most cloud AI use |
| **Strict** | Standard, plus names, organisations and addresses where a label or layout marks them (`Name:`, `Dr. …`, postcodes) | Sensitive work: case files, donor or beneficiary data |

Strict catches more and gets more wrong. A model working with `[PERSON_1]` and `[PERSON_2]` can mix people up. Try it on your real tasks before relying on it.

## Secrets, at every level

API keys, tokens, private keys and passwords in results become `[SECRET_REDACTED]` and are never put back. If the AI tries to send a secret out in a tool call, pMCPg blocks the call.

## Try a level

From a terminal on this computer:

```
pmcpg privacy check --level strict 'Name: Jane Doe, phone +44 20 7946 0958'
```

`pmcpg privacy explain` lists every pattern.

## Fine-tuning

Power users can set exceptions per profile in `config.yaml`: values never to mask (your own address), accounts whose results are left alone, types or fields to skip. See `docs/privacy.md` in the project.

## Use two profiles

Point a local model at a profile with **Off**, and a cloud AI at one with **Standard** or **Strict**. Each gets the right level automatically. See [Profiles](help:profiles).
