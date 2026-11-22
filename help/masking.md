---
title: What masking does and doesn't do
summary: pMCPg can hide personal data from a cloud AI and put it back when the AI uses it. It lowers exposure; it is not anonymity.
group: privacy
order: 1
---
**Beta in v0.1.** Masking catches common patterns like emails and phone numbers. It can miss things, so don't rely on it alone for sensitive data.

When an AI app calls a tool, the result goes into the AI's prompt. With a cloud AI, that means it goes to the AI company. Masking replaces personal data in the result before that happens.

> Before: Reply from Jane Doe &lt;jane.doe@acme.org&gt;, phone +1 613 555 0142
>
> After: Reply from Jane Doe &lt;[EMAIL_1_k7qx]&gt;, phone [PHONE_1_k7qx]

## The AI can still act on it

The same email always gets the same placeholder within a session. If the AI then calls "reply to [EMAIL_1_k7qx]", pMCPg puts the real address back before the call reaches the email server. The AI company never sees it.

The list of placeholders and real values stays in memory. It is gone when the session ends, after 8 hours unused, or when pMCPg restarts. The short tag (`k7qx`) changes on every restart, so an old placeholder is refused instead of restoring someone else's value.

{{diagram:where-data-goes}}

## What it doesn't do

- **It misses some things.** Emails, phone numbers and card numbers are caught well. Names in ordinary sentences mostly are not, even at **Strict**.
- **It masks some things it shouldn't.** Some ordinary words or numbers can look like personal data.
- **Images and files pass through unchanged.** Only text and structured data are masked.
- **Servers see real values.** Online servers get the real data they work on.
- **It is not anonymity.** Context can still identify someone ("the director of the Ottawa office").

## When you need it

| Your AI model | Masking |
|---|---|
| Runs on this computer (LM Studio) | Not needed: nothing leaves |
| Runs in the cloud (Claude, editors with cloud models) | Standard or Strict |

Secrets such as API keys and passwords are always removed from results, even with masking off.

Next: [Pick a privacy level](help:privacy-levels).
