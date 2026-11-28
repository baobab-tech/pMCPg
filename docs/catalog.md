# Catalog

> **Coming soon.** The catalog is not built yet and is not part of 0.1. For now, add a server by its URL, paste a command, or import it from your AI apps. `pmcpg catalog search` prints a "coming soon" note and makes no network request. The plan below stays as the design.

The catalog is a public, read-only list of MCP servers and presets. You will browse it in the web UI or with `pmcpg catalog search`.

- **Server entries** list what each server does, how to install or reach it, which credentials it needs, and a suggested trust level.
- **Presets** are profile templates. Pick one, and the gateway lists the servers it needs and walks you through signing in to each. A preset becomes an ordinary profile you can change.
- The catalog stores no user data, needs no account and logs no queries. It builds on the [official MCP registry](https://github.com/modelcontextprotocol/registry).

General presets include Communication, Research and Coding.

## Social Impact Organizations collection

A curated set of presets for nonprofits, NGOs, foundations and development agencies. These organizations hold sensitive data about donors, staff and the people they serve, often with a small IT team. Each preset ships with stricter privacy defaults and read-only access where it makes sense.

| Preset | Typical servers | Defaults |
|---|---|---|
| **Fundraising and donors** | Donor CRM, email, calendar, shared drive | `strict` masking; approval before sending email or editing donor records |
| **Grants research** | Web search, open grant and funder data, document reader, notes | `standard` masking; approval before anything is sent out after reading web content |
| **M&E and reporting** | Spreadsheets, survey and data collection tools, databases, document drafting | `strict` masking; read-only on source data |
| **Communications** | Email, newsletter platform, social media scheduler, shared drive, image library | `standard` masking; approval before publishing or sending |
| **Program data** | Case management, beneficiary records, open development data (for example IATI) | `strict` masking; read-only; approval on every write |

Presets name types of servers, not vendors. You choose the specific servers your organization uses. To propose a preset or a server entry, open a pull request on the catalog.

## File format

One JSON file, `https://pmcpg.io/catalog/v1/catalog.json`, with a detached signature at `catalog.json.sig`. Schema: `src/catalog/schema.ts`.

```json
{ "format": 1, "serial": 42, "generatedAt": "…", "expires": "…", "servers": [], "presets": [] }
```

- `serial` goes up with every signed build. `expires` is set a few weeks after `generatedAt`.
- Each entry in `servers` is an official MCP Registry `server.json` (schema 2025-12-11), cut to the fields pMCPg uses: `name`, `title`, `description`, `version`, `repository`, `websiteUrl`, `icons`, `packages`, `remotes`.
- `packages[]`: `registryType` (`npm`, `pypi`, `oci`, `mcpb`), `identifier`, an exact `version` (no `latest`, no ranges), `fileSha256` (required for `mcpb`), `transport` (`stdio`), fixed `packageArguments`, and `environmentVariables` with `isSecret`. A secret variable has no default.
- `remotes[]`: `type` (`streamable-http` or `sse`), an `https` URL, and header names. Header values are never in the file.
- pMCPg's review sits in `_meta["io.pmcpg/curation"]`: `tier` (`baobab-built`, `approved`, `community`), `reviewedAt`, `reviewedBy`, `source`, `auth` (`none`, `oauth` with `registration` `dcr`/`cimd`/`manual`, or `header`; `credentials` are names only), `trust`, `privacy`, `approvalHints` (policy rules in `config.yaml` syntax), `audience`, `categories`, `samplePrompt`, `toolsHash`.
- A preset has `id`, `name`, `description`, `audience`, `servers` (entry names from the same file), `privacy` and `approvals` (`open`, `balanced`, `careful`).

Entries are curated, not mirrored: each is a file under `website/catalog/`, added and changed by pull request.

## What an approval covers

- **Packages** are approved at one exact version. `npm` runs as `npx -y name@version`, `pypi` as `uvx name==version`, `oci` as `docker run -i --rm image:version`. An `mcpb` bundle is checked against `fileSha256` before install. A new version needs a new review.
- **Remote servers** are approved per operator and URL; the operator can change its tools at any time. `toolsHash` records the tool list seen at review (`catalogToolsHash` in `src/catalog/tools-hash.ts`: sha256 over the sorted pin hashes). The gateway compares it on first connect, and tool pinning takes over after that.

## Signing

The file is signed with Ed25519 over its exact bytes. The `.sig` file holds the 64-byte signature in base64, one line.

- The private key lives in the signer's OS keychain (`private-mcp-gateway` / `catalog/signing-key`), never on Vercel or in the repository.
- The gateway binary holds the public keys in `CATALOG_PUBLIC_KEYS` (`src/catalog/key.ts`) and accepts a file signed by any of them.
- The key shipped today is a placeholder with no private key, so no catalog verifies until it is replaced.

To make the production key (once, on the signing machine):

```bash
bun scripts/catalog-keygen.ts
```

Put the printed public key in `CATALOG_PUBLIC_KEYS`, set `CATALOG_KEY_IS_PLACEHOLDER` to `false`, and ship a release. To sign a build:

```bash
bun scripts/catalog-sign.ts website/out/catalog/v1/catalog.json
```

To rotate: make a new key with `--replace` on a second machine or after saving the old one, add its public key next to the old one, ship a release, sign with the new key, then remove the old public key in a later release.

## Fetching

- The gateway fetches the catalog only while the user browses it (the web UI's catalog page, `pmcpg catalog search`). Nothing fetches in the background. `catalog: { enabled: false }` in `config.yaml` turns it off.
- `verifyCatalog` (`src/catalog/verify.ts`) checks, in order: size (5 MB cap), signature, schema, `expires`, and `serial` not lower than the last one accepted. Any failure keeps the previous file.
- A verified file is cached in the data directory with its signature. Without a usable cache, the gateway uses a signed snapshot bundled in the binary.

---

[← Back to README](../README.md)
