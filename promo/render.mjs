#!/usr/bin/env node
// Renders an HTML composition to MP4, frame by frame.
//
//   node render.mjs <comp>[,<comp>…] [--format portrait|square|landscape|all] [--fps 30] [--stills 2,6.5,12]
//   Every comp × format runs at the same time, each in its own headless browser.
//   node render.mjs serve            # preview server: open the printed URL, Space pauses, the bar scrubs
//
// Each frame: window.__seek(t) in headless Chromium, PNG screenshot, piped to ffmpeg.
// Output: out/<comp>-<format>.mp4 (H.264, yuv420p, 30 fps, +faststart) and optional stills.

import { spawn } from "node:child_process";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(ROOT, "out");
const FORMATS = {
  portrait: [1080, 1350],
  square: [1080, 1080],
  landscape: [1920, 1080],
};
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Static server for promo/ on 127.0.0.1 (module scripts do not load from file://). */
function serve(port = 0) {
  const server = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return res.writeHead(403).end();
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = resolve(ROOT, `.${path.endsWith("/") ? `${path}index.html` : path}`);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      if (!statSync(file).isFile()) throw new Error();
    } catch {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function render(base, comp, format, fps, stills) {
  const [w, h] = FORMATS[format];
  const browser = await chromium.launch();
  const url = `${base}/comps/${comp}/?w=${w}&h=${h}&render`;
  const open = async () => {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on("pageerror", (e) => console.error("page error:", e.message));
    await p.goto(url);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
    return p;
  };
  let page = await open();
  const duration = await page.evaluate(() => window.__duration);

  // Under heavy load a headless screenshot can stall. Seeking is exact, so a fresh page
  // seeked to the same time gives the same frame: retry on a new page instead of failing.
  const capture = async (t) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await page.evaluate((s) => window.__seek(s), t);
        return await page.screenshot({ type: "png", caret: "hide", timeout: 15_000 });
      } catch (e) {
        if (attempt === 3) throw e;
        console.error(`\nframe at ${t.toFixed(3)}s: ${e.name}, retrying on a new page`);
        await page.close().catch(() => {});
        page = await open();
      }
    }
  };
  const frames = Math.round(duration * fps);

  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, `${comp}-${format}.mp4`);
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18",
      "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart",
      mp4,
    ],
    { stdio: ["pipe", "inherit", "inherit"], shell: false },
  );
  const done = new Promise((ok, fail) => ffmpeg.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));

  const stillFrames = new Map(stills.map((s) => [Math.round(s * fps), s]));
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const png = await capture(i / fps);
    if (stillFrames.has(i)) writeFileSync(join(OUT, `${comp}-${format}-${stillFrames.get(i)}s.png`), png);
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    if (i % (fps * 5) === 0) console.log(`${comp} ${format}: ${i}/${frames} frames`);
  }
  ffmpeg.stdin.end();
  await done;
  await browser.close();
  console.log(`${comp} ${format}: ${frames} frames, ${duration}s, ${((Date.now() - t0) / 1000).toFixed(1)}s → ${mp4}`);
}

const comp = process.argv[2];
if (comp === "serve") {
  const server = await serve(Number(arg("port", 5178)));
  const { port } = server.address();
  console.log(`Preview: http://127.0.0.1:${port}/comps/<comp>/?w=1080&h=1350  (Ctrl+C to stop)`);
} else if (!comp || comp.startsWith("--")) {
  console.error("usage: node render.mjs <comp>[,<comp>…] [--format portrait|square|landscape|all] [--fps 30] [--stills 2,6.5]");
  process.exit(1);
} else {
  const format = arg("format", "portrait");
  const fps = Number(arg("fps", 30));
  const stills = (arg("stills", "") || "").split(",").filter(Boolean).map(Number);
  const formats = format === "all" ? Object.keys(FORMATS) : [format];
  if (formats.some((f) => !FORMATS[f])) throw new Error(`unknown format: ${format}`);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const jobs = comp.split(",").flatMap((c) => formats.map((f) => render(base, c, f, fps, stills)));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.error(`failed: ${r.reason?.message ?? r.reason}`);
  if (results.some((r) => r.status === "rejected")) process.exitCode = 1;
  server.close();
}
