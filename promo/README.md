# pMCPg promo workbench

HTML compositions rendered frame by frame to MP4 for LinkedIn. Build-time only: nothing here reaches the gateway binary, and `promo/` has its own `package.json`.

## Setup

Needs `node` (22+), `ffmpeg` on `PATH` (`brew install ffmpeg`) and Bun for installs.

```bash
cd promo
bun install
npx playwright install chromium-headless-shell
```

## Render

```bash
node render.mjs gateway-short                       # 4:5 portrait, 1080×1350 (feed default)
node render.mjs gateway-short --format square       # 1080×1080
node render.mjs gateway-short --format landscape    # 1920×1080
node render.mjs gateway-short --format all --stills 4.5,7.6,10.9,13.5
node render.mjs keys-short                          # "Your AI tools, your control" cut
```

Output goes to `out/` (gitignored): `out/<comp>-<format>.mp4`, plus `out/<comp>-<format>-<t>s.png` for each `--stills` time.

Encoding: H.264, `yuv420p`, 30 fps, CRF 18, `+faststart`. No audio track; every beat carries on-screen text, so the videos work muted.

## Preview

```bash
node render.mjs serve
```

Open `http://127.0.0.1:5178/comps/gateway-short/?w=1080&h=1350`. It plays in real time; Space pauses, the bar at the bottom scrubs. Change `w`/`h` to check the other formats.

## Boards

Static draft stills for agreeing on a script before animating it. Run `node render.mjs serve`, then open `http://127.0.0.1:5178/boards/keys-variations/`.

## How it works

- `lib/stage.js` owns the clock. A composition builds one [Motion](https://motion.dev) sequence (`animate([...])`), the stage pauses it, and `window.__seek(t)` sets `controls.time = t`. Nothing reads wall-clock time, so frame N is the same on every render.
- Anything Motion does not drive (wires drawing in, dots moving along paths) goes in `onFrame(t)`, a pure function of `t`.
- `render.mjs` serves `promo/` on `127.0.0.1`, opens headless Chromium (Playwright) at the format's size, then per frame: seek, PNG screenshot, pipe to `ffmpeg`.
- `lib/theme.css` copies the web UI's dark palette and Oxanium font. It also sets safe margins per format: LinkedIn draws UI over the edges of feed video.
- `lib/icons.js` holds the line icons, the pMCPg shield, and the Claude, VS Code and ChatGPT marks already bundled in `ui/components/app-logos.tsx`. Apps with no mark in the repo get letter tiles.

## Pinned versions

| Package | Version | Role |
| --- | --- | --- |
| `motion` | 14.14.0 | Timeline and easing (same library as the web UI) |
| `playwright` | 1.65.1 | Headless Chromium for frame capture |
| `@fontsource/oxanium` | 5.3.0 | The UI's font, served locally |

## Adding a composition

Copy `comps/gateway-short/`, keep the `stage({ duration, build, onFrame })` call, and lay out with the `data-format` attribute on `<html>` (`portrait`, `square`, `landscape`).
