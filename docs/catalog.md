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

---

[← Back to README](../README.md)
