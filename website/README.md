# pmcpg.io

The promo site and public guides for Private MCP Gateway. Next.js static export, deployed on Vercel. Nothing here reaches the gateway binary.

## Content

- Home page: `app/page.tsx` and `components/`. Install commands live in `lib/site.ts` and match `docs/install.md`.
- Guides: `/help/<slug>/`, built from the shared `help/*.md` at the repo root. The gateway's web UI shows the same files. Edit them there, once.
- Pictures in guides: `{{diagram:…}}` markers map to `components/help/diagrams.tsx`, a copy of `ui/components/help/diagrams.tsx`. Keep both in step.
- `design/` holds the HTML mockups the page was built from. `CONTENT-PLAN.md` holds the content plan and copy rules.

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
