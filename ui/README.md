# pMCPg web UI

Next.js + shadcn/ui (Base UI), static export. Build-time only: the export in `out/` is embedded in the `pmcpg` binary and served by the gateway at `/`. It talks to the JSON API in `src/api/` under `/api/ui/*`.

- Build: `bun run build:ui` from the repository root (installs, builds, writes `src/api/ui-assets.gen.ts`).
- Try it: `bun run --cwd ui build`, then `PMCPG_HOME=/tmp/pmcpg-dev PMCPG_NO_BROWSER=1 bun scripts/dev-ui.ts --port 7499`.
- No server features: no route handlers, server actions or request-time data. Pages are client components that call the API.
- Inline scripts from the export are allowed by SHA-256 hashes in the CSP, computed when the files are scanned.
