// Shared stage for every composition.
// - Sizes the page from ?w=&h= (default 1080×1350) and sets data-format on <html>.
// - Owns the clock: time only moves through window.__seek(t), so every frame is reproducible.
// - Plays in real time when opened without ?render (preview), with a scrubber.
//
// A composition calls stage({ duration, build, onFrame }):
//   build()      returns Motion animation controls (or an array of them); they are paused and seeked.
//   onFrame(t)   draws anything Motion does not own (dots on paths, line drawing). Must be a pure function of t.

const params = new URLSearchParams(location.search);
export const W = Number(params.get("w") ?? 1080);
export const H = Number(params.get("h") ?? 1350);
export const FORMAT = W > H ? "landscape" : W === H ? "square" : "portrait";
const RENDER = params.has("render");

document.documentElement.style.setProperty("--W", `${W}px`);
document.documentElement.style.setProperty("--H", `${H}px`);
document.documentElement.dataset.format = FORMAT;

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Linear 0→1 progress of t through [a, b], clamped. */
export const prog = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export async function stage({ duration, build, onFrame = () => {} }) {
  await document.fonts.ready;
  const list = [build()].flat();
  for (const c of list) c.pause();

  const seek = async (t) => {
    for (const c of list) c.time = t;
    onFrame(t);
    await nextFrame();
    await nextFrame();
  };

  window.__duration = duration;
  window.__seek = seek;
  await seek(0);
  window.__ready = true;

  if (!RENDER) preview(duration, seek);
}

/** Real-time playback with a scrubber, for authoring in a normal browser. */
function preview(duration, seek) {
  const bar = document.createElement("input");
  Object.assign(bar, { type: "range", min: 0, max: duration, step: 1 / 30, value: 0 });
  bar.style.cssText = "position:fixed;left:16px;right:16px;bottom:8px;z-index:99;width:calc(100% - 32px)";
  document.body.append(bar);
  let playing = true;
  let start = performance.now();
  bar.addEventListener("input", () => {
    playing = false;
    seek(Number(bar.value));
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    playing = !playing;
    start = performance.now() - Number(bar.value) * 1000;
  });
  const loop = () => {
    if (playing) {
      const t = ((performance.now() - start) / 1000) % duration;
      bar.value = String(t);
      seek(t);
    }
    requestAnimationFrame(loop);
  };
  loop();
}
