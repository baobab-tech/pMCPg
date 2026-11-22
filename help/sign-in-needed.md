---
title: “Sign-in needed”
summary: The service stopped accepting the saved sign-in. Sign in again once; nothing else changes.
group: troubleshooting
order: 2
---
pMCPg refreshes sign-ins on its own, before they expire. "Sign-in needed" means the service refused the refresh. Common reasons:

- You changed your password with that service.
- You, or an admin, removed pMCPg's access in the service's settings.
- The service ends sign-ins after a set time, or changed the permissions it grants.
- For an API key: the key was deleted, expired or lost a permission.

## Fix it

1. Open [Accounts](/accounts/), or [check the account here](help:account-not-working).
2. Choose **Sign in** and finish in your browser. For an API key, choose **Keys** and paste a new one.
3. The account turns **Connected** and its tools come back for the AI.

Your profiles, rules and other accounts are not affected.

## Meanwhile

The account's tools are hidden from the AI, so it won't keep trying calls that fail. pMCPg never asks the AI or the app to handle a sign-in.

## It keeps coming back

- Some organisations limit how long apps stay signed in. Ask your IT admin whether the limit can be longer for this service.
- If the sign-in page shows an error about the redirect address, the service may need `http://127.0.0.1:7431/oauth/callback` added to its allowed addresses.
