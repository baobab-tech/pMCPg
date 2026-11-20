# Security

Every credential and every tool result passes through one local process. These are the controls around it.

## Web UI security

- Binds to `127.0.0.1:7431`. Any other bind address requires a password.
- On loopback without a password, every local user and process on the machine is trusted. The launch link stops a process from taking over the UI by opening the plain address; it does not stop one that can read `state.db` or the keychain.
- Without a password, the UI opens only through a one-time launch link (`pmcpg open`, or the link `pmcpg serve` prints). The link works once, within 15 minutes, and is stored hashed in `state.db`. Opening the plain address gives no session, so another user or process on the machine cannot take the UI over.
- Password hashed with Argon2id. No account, no email, no recovery service. Reset with `pmcpg ui reset-password` on the machine.
- `HttpOnly`, `SameSite=Strict` session cookie with idle timeout.
- CSRF token on every change. `Host` and `Origin` checks against DNS rebinding.
- CSP with `script-src 'self'` plus the hashes of the UI's own inline scripts, no outside origins. `style-src` allows inline styles. Scripts, styles and fonts ship inside the binary.
- With a password set, some destructive actions ask for it again. Not every route does.
- The UI and the MCP endpoint use separate auth. A client token cannot open the UI. A UI session cannot call tools, but it can read client tokens.

## Stdio servers

- Stdio servers run as child processes of the gateway, as the same OS user. There is no sandbox.
- A stdio server can read everything that user can read: the master key in the OS keychain (the OS may prompt), `state.db`, `config.yaml`, and the user's other files. With the master key it can decrypt every stored secret and the activity log.
- Run only stdio servers you trust as you trust any program you install. Remote servers never see the vault.
- The environment is reduced to an allow list of system variables plus the server's own configured ones.
- Secrets are injected from the vault at spawn time.
- Stopping a server stops its process tree: the gateway walks child PIDs on Unix and runs `taskkill /T` on Windows. A process that detaches from its parent can survive.
- Sandboxing is not built.

## Threat model, short version

| Threat | Mitigation |
|---|---|
| Model provider reads personal data in tool results | PII masking with re-hydration |
| Prompt injection triggers data exfiltration | Data-flow rules, approvals, secret scanning on arguments. Data-flow rules see only traffic through the gateway, not the client's own tools, and do nothing until servers carry trust labels |
| Server changes tool descriptions or annotations after approval | Tool pinning and quarantine (hash covers name, title, description, schema, annotations) |
| A tool asks for placeholders to collect another account's data | Placeholders go back only to the account they came from |
| Credentials leak from config files or through the model | Encrypted in `state.db`, master key in the OS keychain; credentials injected after the model |
| One profile's data reaches another | Separate endpoints and tokens per profile |
| A web page drives the web UI | CSRF tokens, `Origin` and `Host` checks, `SameSite=Strict` cookies |

Out of scope: a compromised host machine, a compromised OS keychain, a malicious stdio server (it runs as you), attacks on the model provider.

---

[← Back to README](../README.md)
