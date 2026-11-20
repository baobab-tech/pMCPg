# Plan: vault drop (private files)

Status: proposed. Not in the [roadmap](../roadmap.md) yet.

## Goal

Let a user give the AI a file without uploading it to the chat. The file goes to pMCPg instead. The AI reads it through a gateway tool, and personal data in it comes back as placeholders. The model provider never receives the raw file.

Today a chat upload goes straight to the provider. The gateway only sees what MCP servers return, so it cannot help with uploads.

## User flow

1. The user drops the file on the pMCPg window ("Drop a private file"), or runs `pmcpg files add lease.pdf`.
2. pMCPg extracts the text and shows a preview of what the AI will see, with masked values highlighted.
3. The user adds anything the detectors missed (names in running text are the usual case), then clicks **Make available**.
4. pMCPg copies a short prompt to the clipboard: `Use pMCPg to read my private file "Lease 2026" (f_8k2m).`
5. The user pastes it into the chat. The AI calls `search_tools`, finds the file tools, and reads the file through `call_tool`.
6. The AI answers with placeholders such as `[PERSON_1_k7qx]`. The chat app shows them as they are. pMCPg restores real values only when they go back into a tool call, under the rules below.

## Design

### Built-in `files` account

The file tools are a built-in account, `files`, served in-process by the gateway. They go through the existing front door and pipeline, so the design needs no new front-door tools. Policy, masking, cross-account checks, events and the activity log apply unchanged.

| Tool | Does | Annotations |
|---|---|---|
| `files__list` | Files in this profile: id, masked title, type, size, pages, expiry | read-only |
| `files__read` | Text of one file from `offset`, at most `maxChars` (default 8,000), with a `next` cursor | read-only |
| `files__search` | Passages in one file or all files that match a query (MiniSearch over chunks) | read-only |

- No tool returns the original bytes.
- Results are plain text, plus `structuredContent` rows for CSV.
- `runtime.ts` `getConnector` returns an in-process `Connector` for `files`. The catalog lists its tools like any other account's.

### Masking

- The mask step runs on `files__*` results as on any result. Placeholders record `files` as their source account.
- **Level.** Files default to `strict`, whatever the profile's level, because the user chose to hide them. This needs a per-account level in `privacyOptions`: `accountLevels: { files: "strict" }`. The privacy module owns that schema and may add the field.
- **User terms.** Each file keeps a list of extra values to mask, typed or picked in the preview. A new `termsDetector` (tier 0, exact match, case-insensitive) runs only on that file's results and assigns the type the user chose (`PERSON`, `ORG`, `ADDRESS`).
- **Name suggestions.** The preview pre-ticks likely names, such as capitalised word pairs that repeat or follow "Mr", "Dr" or "Dear". The user unticks false positives. This covers the tier 0 gap for names in running text until tier 1 lands.
- **Titles.** File names often hold personal data ("Divorce_JaneDoe.pdf"). The model sees a masked title. Events and logs carry only the file id.

### Re-hydration

- Values from a file go back only to the `files` account by default, so the PRV-1 rule applies as it stands. A placeholder from a file cannot reach the email tool unless the user adds that account to `shareAcrossAccounts`.
- Placeholders carry the session tag. After a restart the AI must read the file again. Old placeholders are refused, not restored to the wrong value.

### Trust and policy

- The `files` account carries trust labels `private-data` and `external-content`. A received PDF can carry prompt injection.
- Under the balanced preset, after the AI reads a file, a later call that sends data out asks for approval. The approval preview shows the real values.

### Storage

- **At rest.** A new append-only migration adds a `files` table in `state.db`. The extracted text, the original bytes and the user terms are encrypted with a key derived from the vault master key, the same way `DbVault` encrypts rows. Metadata (id, profile, size, type, created, expires) is stored in clear; the original file name is encrypted.
- **Lifetime.** Files expire after 7 days by default (`files.keepDays`) and can be deleted from the UI or with `pmcpg files rm`. Deletion removes the row and runs `VACUUM` on the next start.
- **Scope.** A file belongs to the profile picked at drop time (default: the profile of the last connected app, else `all`). `files__list` shows only that profile's files.
- **Limits.** 25 MB per file, 2 million extracted characters, 200 files.

### Extraction

The runtime has a fixed dependency list, so v1 extracts only what Bun can read alone:

| Format | v1 | How |
|---|---|---|
| `.txt` `.md` `.csv` `.tsv` `.json` `.log` | yes | Read as UTF-8 |
| `.html` | yes | Strip tags and scripts and keep text |
| `.eml` | yes | Headers plus the `text/plain` part, or the HTML part stripped |
| `.docx` `.xlsx` `.pptx` | yes | Small ZIP reader (central directory plus `DecompressionStream("deflate-raw")`), then XML text nodes |
| `.pdf` | later | See open questions |
| Images, scans | later | OCR; see open questions |

Extraction runs in a `Worker` with a timeout and memory cap, so a malformed file cannot hang or crash the gateway.

### Web UI and API

- **Drop zone.** On the home page and in a new **Private files** page: list, preview, terms, expiry, delete.
- **Routes.** `POST /api/files` (multipart), `GET /api/files`, `GET /api/files/:id/preview`, `PUT /api/files/:id/terms`, `DELETE /api/files/:id`. They sit behind the admin token and the existing Host and Origin checks.
- **Preview.** Rendered with a throwaway session, so preview placeholders never enter a live session.
- **Warning text.** The UI says plainly: do not also upload this file to the chat; masking can miss things; dates, places and job titles can still identify a person.

### CLI

`pmcpg files add <path> [--profile p] [--term "Jane Doe"]...`, `pmcpg files list`, `pmcpg files show <id>` (masked preview), `pmcpg files rm <id>`. The commands go in `src/cli/commands-files.ts`.

## Code layout

| Path | Contents |
|---|---|
| `src/files/store.ts` | Encrypted table access, expiry |
| `src/files/extract/` | One extractor per format, plus the worker |
| `src/files/connector.ts` | In-process `Connector` for the `files` account |
| `src/privacy/terms.ts` | `termsDetector` (privacy module) |
| `src/cli/commands-files.ts` | CLI |
| `ui/` | Drop zone and Private files page |
| `test/files/` | Tests, with sample files in `test/fixtures/files/` |

## Contract changes (need the main session's approval)

- `src/store/db.ts`: append a migration for the `files` table.
- `src/core/config.ts`: a `files` section (`enabled`, `keepDays`, `maxBytes`) and a reserved account id `files` that users cannot define.
- `src/gateway/handle.ts`: file methods for the UI (`addFile`, `listFiles`, `previewFile`, `setFileTerms`, `deleteFile`).
- `src/store/events.ts`: a `file` event (`added`, `read`, `deleted`, with id and counts only), or reuse `call` events and add nothing.
- Module-owned, no approval needed: `privacyOptions.accountLevels` in `src/privacy/schema.ts`.

## Phases

1. **Text files.** Text, CSV, HTML and email formats. Store, connector, the three tools, strict level, user terms, name suggestions, drop zone, preview, CLI.
2. **Office files.** DOCX, XLSX and PPTX through the ZIP reader. Folder watch (`~/pMCPg Drop`) as an optional second entry point.
3. **PDF and scans,** once the extraction approach is chosen. Tier 1 NER replaces most manual terms.
4. **Send the original.** Pass a stored file to a tool (for example, attach to an email) as a `[FILE_n_tag]` handle the gateway swaps for the bytes, under the same cross-account rule and an approval.

## Limits

- The user has to use the drop zone. A file uploaded to the chat bypasses pMCPg.
- Detection misses names, addresses and context that identify a person. User terms and tier 1 reduce misses but cannot remove them.
- The AI sees placeholders, so it cannot judge things that depend on the value itself, such as whether an address is in Kenya or whether two spellings are the same person.
- Masked text still goes to the provider. This plan protects identifiers, not the subject matter of the document.

## Open questions

- **Name.** "Vault" already means the secrets store (`src/vault/`). Use "Private files" in the UI and `files` in code?
- **PDF.** Options: (a) an optional extractor (pdf.js) downloaded on demand, pinned by hash and run in a worker, like the tier 1 and tier 2 detectors; (b) on macOS, a bundled Swift helper using PDFKit; (c) ask the user to export the PDF as text. Option (a) keeps the binary unchanged and works on every OS.
- **OCR.** Apple Vision on macOS through a helper, or an optional Tesseract download?
- **Default lifetime.** 7 days, or delete when the gateway stops?
- **Profile.** Pick the profile at drop time, or always use `all`?
- **Trust labels.** Should `external-content` be on by default? It adds approval prompts after every file read under balanced.
