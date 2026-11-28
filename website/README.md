# pmcpg.io

The promo site and public guides for Private MCP Gateway. Next.js static export, deployed on Vercel. Nothing here reaches the gateway binary.

## Content

- Home page: `app/page.tsx` and `components/`. Install commands live in `lib/site.ts` and match `docs/install.md`.
- Guides: `/help/<slug>/`, built from the shared `help/*.md` at the repo root. The gateway's web UI shows the same files. Edit them there, once.
- Pictures in guides: `{{diagram:…}}` markers map to `components/help/diagrams.tsx`, a copy of `ui/components/help/diagrams.tsx`. Keep both in step.
- `design/` holds the HTML mockups the page was built from. `CONTENT-PLAN.md` holds the content plan and copy rules.

## Catalog

The signed MCP server catalog served at `/catalog/v1/catalog.json`, and the `/catalog/` page built from it. Format and review rules: `docs/catalog.md`.

- Sources: `catalog/servers/<slug>.json` (one entry each) and `catalog/presets/<id>.json`, checked against `src/catalog/schema.ts`.
- `bun run catalog:import <registry-name>` writes a draft entry from the official MCP Registry. Maintainer only; the gateway never calls the registry.
- `bun run catalog:build` validates the sources, bumps `serial`, sets `expires` 90 days out and writes `public/catalog/v1/catalog.json`. Run it before committing, never on Vercel.
- `prebuild` (`scripts/check-catalog.ts`) fails the build when `catalog.json` does not match the sources. It also checks `catalog.json.sig` against `CATALOG_PUBLIC_KEYS`: a warning while `CATALOG_KEY_IS_PLACEHOLDER` is true, an error after.

To publish a change, on the machine that holds the signing key:

```bash
bun run catalog:build
```

```bash
bun ../scripts/catalog-sign.ts public/catalog/v1/catalog.json
```

Then commit `catalog.json` and `catalog.json.sig` together.

The scripts import the gateway's schema from `../src`. `zod` is a website devDependency and the scripts run with `NODE_PATH=./node_modules`, so they work on Vercel, where only `website/` is installed.

## Run

```bash
bun install
```

```bash
bun run dev
```

```bash
bun run build
```

`build` copies `docs/assets/*.svg` into `public/help/` first, then writes the site to `out/`.

## Deploy

Builds run locally, so the build can read `../help` and `../docs`:

```bash
vercel build --target preview && vercel deploy --prebuilt --target preview
```

Production: the same with `--prod` on both commands.
