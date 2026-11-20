# Security policy

## Report a vulnerability

Report it privately through GitHub: [Security → Report a vulnerability](https://github.com/baobab-tech/pMCPg/security/advisories/new).

Do not open a public issue, pull request or discussion for a security problem.

Include:

- the version (`pmcpg version`) and OS
- what an attacker can do, and what they need first (local user, same network, a malicious MCP server, a prompt injection)
- steps or a proof of concept

We reply within 5 working days and keep you updated until a fix ships. We credit reporters in the release notes unless you ask us not to.

## Supported versions

Only the latest release gets security fixes. pMCPg is pre-1.0, so fixes ship in a new release and are not backported.

## Scope

In scope: the `pmcpg` binary, the web UI, the install scripts, the npm launcher, the Docker images and the release pipeline.

Out of scope:

- vulnerabilities in third-party MCP servers you connect
- attacks that need the same OS user account with write access to `state.db` or the keychain (see [VLT-1](docs/security-registry.md))
- data you type into an AI app's chat, which never passes through the gateway

Known issues and their status are in the [security registry](docs/security-registry.md). The threat model is in [docs/security.md](docs/security.md).
