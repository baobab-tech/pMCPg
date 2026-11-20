---
title: The Mac keychain prompt
summary: macOS asks whether pmcpg may use its keychain entry. Enter your Mac password and choose Always Allow.
group: troubleshooting
order: 5
---
{{diagram:keychain-prompt}}

## What it is

pMCPg keeps one master key in your Mac's login keychain. It unlocks the keys and sign-ins pMCPg stores. macOS asks you before it lets any app read a keychain entry.

## When it appears

- The first time pMCPg starts.
- After an update, if that build isn't signed with an Apple Developer ID. macOS sees the updated file as a new app. Signed releases keep their access across updates.

## What to do

1. Type your Mac login password.
2. Choose **Always Allow**. Plain **Allow** works once and asks again next time.

If you choose **Deny**, pMCPg can't read its key and can't start. It waits up to 2 minutes for an answer, then stops with a message that the keychain read timed out.

## Is it safe?

Yes. macOS checks your password itself; pMCPg never sees it. The master key stays in the keychain and is handed only to pMCPg.

## If something went wrong

- **You chose Deny, or missed the prompt:** restart pMCPg and answer it.
- **The keychain is locked:** unlock it in **Keychain Access**, or sign out and back in.
- **To check or reset access:** open **Keychain Access**, search for `private-mcp-gateway`, open the entry and look at **Access Control**. pmcpg should be in the list.
- **“No master key” at start-up:** the entry was deleted. pMCPg won't make a new key over your data, because the old secrets could never be read again. Restore your keychain from a backup if you have one, and don't delete `state.db` before you've checked: it holds your accounts' keys.

Windows and Linux don't show this prompt. On Linux, unlock your keyring (GNOME Keyring or KWallet) if asked.
