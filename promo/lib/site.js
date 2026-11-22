// Helpers for compositions in the website's visual language (load lib/site.css too).
// Everything that changes over time here is a pure function of t, so frames stay reproducible.

import { easeInOut, prog } from "./stage.js";

export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });

/** The pMCPg mark used on pmcpg.io (website/components/logo.tsx). */
export const LOGO = (size = 48) =>
  `<svg viewBox="0 0 160 160" width="${size}" height="${size}" aria-hidden="true"><g fill="none" stroke="#3db8d8" stroke-width="9" stroke-linecap="round"><path d="M6,56 C24,56 30,80 50,80"/><path d="M6,104 C24,104 30,80 50,80"/><path d="M110,80 C130,80 136,40 154,40"/><path d="M110,80 C130,80 136,80 154,80"/><path d="M110,80 C130,80 136,120 154,120"/></g><rect x="40" y="40" width="80" height="80" rx="20" fill="#3db8d8"/><path d="M68,78 v-9 a12,12 0 0 1 24,0 v9" fill="none" stroke="#fff" stroke-width="6"/><rect x="62" y="77" width="36" height="26" rx="5" fill="#fff"/></svg>`;

/** Window chrome: three dots, a title, optional right-hand note. */
export const winBar = (title, right = "") => `<div class="win-bar"><i></i><i></i><i></i>${title}${right ? `<span class="r">${right}</span>` : ""}</div>`;

/** Last entry of a time-sorted [[t, value], …] list that has started by t, or the fallback. */
export function stateAt(t, events, fallback = null) {
  let v = fallback;
  for (const [at, val] of events) if (t >= at) v = val;
  return v;
}

/** 0→1 fade in over [a, a+d], and back to 0 over [b, b+d] when b is given. */
export function fade(t, a, d = 0.35, b = Number.POSITIVE_INFINITY) {
  const out = Number.isFinite(b) ? prog(t, b, b + d) : 0;
  return Math.min(prog(t, a, a + d), 1 - out);
}

/** Types text into an element at cps characters per second from time a. */
export function typeInto(node, text, t, a, cps = 40) {
  const n = Math.max(0, Math.min(text.length, Math.floor((t - a) * cps)));
  node.textContent = text.slice(0, n);
  return n === text.length;
}

/** Measures a node's box relative to an ancestor using offsets (ignores transforms). */
export function boxIn(node, root) {
  let x = 0;
  let y = 0;
  let e = node;
  while (e && e !== root) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent;
  }
  return { x, y, w: node.offsetWidth, h: node.offsetHeight };
}

/** S-curve between two points, horizontal or vertical, as in the site's live example. */
export function curve(a, b, vertical) {
  if (vertical) {
    const m = (a[1] + b[1]) / 2;
    return `M${a[0]},${a[1]} C${a[0]},${m} ${b[0]},${m} ${b[0]},${b[1]}`;
  }
  const m = (a[0] + b[0]) / 2;
  return `M${a[0]},${a[1]} C${m},${a[1]} ${m},${b[1]} ${b[0]},${b[1]}`;
}

/**
 * Moves a packet element along an SVG path between times a and b (reverse when back is true).
 * Returns true while the packet is on the wire.
 */
export function movePacket(pk, path, len, t, a, b, back = false) {
  const p = prog(t, a, b);
  const on = t >= a && t <= b;
  if (!on) {
    pk.style.opacity = "0";
    return false;
  }
  const f = easeInOut(p);
  const pt = path.getPointAtLength((back ? 1 - f : f) * len);
  pk.style.translate = `${pt.x}px ${pt.y}px`;
  pk.style.opacity = String(Math.min(1, p * 8, (1 - p) * 8));
  return true;
}

/** Fills the shared end card. Returns Motion segments that bring it in at time a. */
export function endCard(node, { line, small = "" }, a) {
  node.innerHTML = `
    <div class="logo" id="endLogo">${LOGO(150)}</div>
    <div class="name" id="endName">pMCPg</div>
    <div class="full" id="endFull">Private MCP Gateway</div>
    <div class="line" id="endLine">${line}</div>
    <div class="url" id="endUrl">pmcpg.io</div>
    ${small ? `<div class="small" id="endSmall">${small}</div>` : ""}`;
  const out = "easeOut";
  const pop = [0.34, 1.4, 0.64, 1];
  return [
    [node, { opacity: [0, 1] }, { at: a, duration: 0.45, ease: out }],
    ["#endLogo", { opacity: [0, 1], scale: [0.5, 1] }, { at: a + 0.15, duration: 0.6, ease: pop }],
    [["#endName", "#endFull"], { opacity: [0, 1], y: [30, 0] }, { at: a + 0.35, duration: 0.5, ease: out }],
    ["#endLine", { opacity: [0, 1], y: [20, 0] }, { at: a + 0.8, duration: 0.5, ease: out }],
    [small ? ["#endUrl", "#endSmall"] : "#endUrl", { opacity: [0, 1], scale: [0.9, 1] }, { at: a + 1.1, duration: 0.5, ease: pop }],
  ];
}
