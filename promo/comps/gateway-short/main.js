// "Every AI app, one private gateway": 14.5 s short.
// Beats: headline + apps → pMCPg → services (0–5.8 s), keys stay local (5.8–8.4 s),
// personal data masked (8.4–11.3 s), end card with the install line (11.3–14.5 s).

import { ICONS, MARKS, SHIELD } from "../../lib/icons.js";
import { easeInOut, prog, stage } from "../../lib/stage.js";

const { animate, stagger } = window.Motion;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const NS = "http://www.w3.org/2000/svg";

const DURATION = 14.5;

// ---- Content ---------------------------------------------------------------------------------

const APPS = [
  { name: "Claude", tile: MARKS.claude(32), bg: "var(--claude)" },
  { name: "ChatGPT", tile: MARKS.chatgpt(34), bg: "var(--chatgpt)" },
  { name: "Pi", tile: "Pi", bg: "#7c5cff" },
  { name: "VS Code", tile: MARKS.vscode(30), bg: "#007acc" },
  { name: "Any MCP app", tile: ICONS.plus, bg: "#404040" },
];
const SERVICES = [
  { name: "Notes", icon: ICONS.notes },
  { name: "Files", icon: ICONS.files },
  { name: "Issues", icon: ICONS.issues },
  { name: "Calendar", icon: ICONS.calendar },
  { name: "Email", icon: ICONS.mail },
  { name: "Database", icon: ICONS.database },
];
const MASKED = [
  { k: "Name", orig: "Maria Lopez", tok: "[PERSON_1]" },
  { k: "Email", orig: "maria.lopez@example.org", tok: "[EMAIL_1]" },
  { k: "Phone", orig: "+1 613 555 0142", tok: "[PHONE_1]" },
];
const CAPTIONS = [
  { icon: ICONS.plug, text: "Connect each app once.<br>Reach every tool." },
  { icon: ICONS.key, text: "Your keys stay on<br>your computer." },
  { icon: ICONS.eyeOff, text: "Personal data is masked before the AI sees it." },
];

// ---- Geometry (diagram units, 1160×640) -----------------------------------------------------------

const appY = (i) => 64 + i * 128;
const svcY = (i) => 50 + i * 108;
const HUB_L = 445;
const HUB_R = 715;
const HUB_Y = 320;
const KEY_SLOTS = [470, 550, 630]; // chip x inside the "Your computer" box, y = 408
const KEY_FROM = [0, 2, 4]; // services the keys fly in from

// ---- Build DOM ----------------------------------------------------------------------------------

$("eyebrow").innerHTML = `${SHIELD(30)} pMCPg`;
const diagram = $("diagram");
const wires = $("wires");

const appEls = APPS.map((a, i) => {
  const p = el("div", "pill app", `<span class="tile" style="background:${a.bg}">${a.tile}</span>${a.name}`);
  Object.assign(p.style, { left: "0px", top: `${appY(i) - 42}px` });
  diagram.append(p);
  return p;
});
const svcEls = SERVICES.map((s, i) => {
  const p = el("div", "pill svc", `<span class="tile">${s.icon}</span>${s.name}`);
  Object.assign(p.style, { left: "840px", top: `${svcY(i) - 38}px` });
  diagram.append(p);
  return p;
});

const hub = el("div", "hub", `${SHIELD(56)}pMCPg<span class="lockbadge" id="lockbadge">${ICONS.lock}</span>`);
diagram.append(hub);
$("boundaryLabel").innerHTML = `${ICONS.laptop} Your computer`;

const keyEls = KEY_SLOTS.map((x) => {
  const k = el("div", "keychip", ICONS.key);
  Object.assign(k.style, { left: `${x}px`, top: "408px" });
  diagram.append(k);
  return k;
});

function wire(d, color, opacity) {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", color);
  p.setAttribute("stroke-opacity", opacity);
  p.setAttribute("stroke-width", "3");
  wires.append(p);
  const len = p.getTotalLength();
  p.style.strokeDasharray = `${len}`;
  return { p, len };
}
function dot(color) {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("r", "7");
  c.setAttribute("fill", color);
  wires.append(c);
  return c;
}

const COLORS = ["#d97757", "#10a37f", "#a08cff", "#3ba7f0", "#a3a3a3"];
const appWires = APPS.map((_, i) => {
  const y = appY(i);
  return {
    ...wire(`M320 ${y} C 390 ${y}, 380 ${HUB_Y}, ${HUB_L} ${HUB_Y}`, COLORS[i], 0.55),
    dots: [dot(COLORS[i]), dot("#3db8d8")],
  };
});
const svcWires = SERVICES.map((_, i) => {
  const y = svcY(i);
  return {
    ...wire(`M${HUB_R} ${HUB_Y} C 780 ${HUB_Y}, 770 ${y}, 840 ${y}`, "#3db8d8", 0.5),
    dots: [dot("#3db8d8"), dot("#9fe3f3")],
  };
});

CAPTIONS.forEach((c, i) => {
  const cap = el("div", "cap", `<span class="ic">${c.icon.replace(/width="24" height="24"/, 'width="46" height="46"')}</span><span>${c.text}</span>`);
  cap.id = `cap${i}`;
  $("caption").append(cap);
});

$("maskTop").innerHTML = `${ICONS.mail} Email tool result`;
$("rows").innerHTML = MASKED.map(
  (m, i) => `<div class="row"><span class="k">${m.k}</span><span class="v"><span class="orig" id="orig${i}">${m.orig}</span><span class="tok" id="tok${i}">${m.tok}</span></span></div>`,
).join("");
$("maskFoot").innerHTML = `${SHIELD(30, "#3db8d8")} Masked on your computer, then sent to <b>Claude</b>`;

$("end").innerHTML = `
  <div class="logo" id="endLogo">${SHIELD(96)}</div>
  <div class="name" id="endName">pMCPg</div>
  <div class="full" id="endFull">Private MCP Gateway</div>
  <div class="free" id="endFree">Free · runs on your computer</div>
  <div class="cmd" id="endCmd"><span class="p">$</span> curl -fsSL …/install.sh | sh</div>
  <div class="os" id="endOs">macOS · Linux · Windows</div>`;

/** Scale the 1160×640 diagram to fit its grid cell. */
function fit() {
  const r = $("dwrap").getBoundingClientRect();
  const s = Math.min(r.width / 1160, r.height / 640);
  diagram.style.scale = String(s);
}
fit();

// ---- Timeline -------------------------------------------------------------------------------------

const out = "easeOut";
const pop = [0.34, 1.4, 0.64, 1]; // slight overshoot

function build() {
  return animate([
    // Headline
    ["#eyebrow", { opacity: [0, 1], y: [20, 0] }, { at: 0.1, duration: 0.5, ease: out }],
    ["#h1a", { opacity: [0, 1], y: [40, 0] }, { at: 0.25, duration: 0.6, ease: out }],
    ["#h1b", { opacity: [0, 1], y: [40, 0] }, { at: 0.55, duration: 0.6, ease: out }],

    // Apps → hub → services
    [appEls, { opacity: [0, 1], x: [-50, 0] }, { at: 0.8, duration: 0.5, delay: stagger(0.1), ease: out }],
    [hub, { opacity: [0, 1], scale: [0.6, 1] }, { at: 1.4, duration: 0.6, ease: pop }],
    [svcEls, { opacity: [0, 1], x: [50, 0] }, { at: 2.3, duration: 0.5, delay: stagger(0.08), ease: out }],
    ["#cap0", { opacity: [0, 1], y: [30, 0] }, { at: 3.2, duration: 0.5, ease: out }],
    ["#cap0", { opacity: [1, 0], y: [0, -30] }, { at: 5.6, duration: 0.35, ease: "easeIn" }],

    // Keys stay on your computer
    ["#boundary", { opacity: [0, 1], scale: [1.08, 1] }, { at: 5.8, duration: 0.5, ease: out }],
    ["#cap1", { opacity: [0, 1], y: [30, 0] }, { at: 5.95, duration: 0.5, ease: out }],
    ...keyEls.map((k, i) => [
      k,
      { opacity: [0, 1, 1], x: [870 - KEY_SLOTS[i], 0], y: [svcY(KEY_FROM[i]) - 30 - 408, 0], scale: [0.6, 1] },
      { at: 6.3 + i * 0.18, duration: 0.8, ease: "easeInOut" },
    ]),
    ["#lockbadge", { opacity: [0, 1], scale: [0.3, 1] }, { at: 7.2, duration: 0.45, ease: pop }],
    ["#cap1", { opacity: [1, 0], y: [0, -30] }, { at: 8.2, duration: 0.35, ease: "easeIn" }],

    // Personal data masked
    [diagram, { opacity: [1, 0.15] }, { at: 8.3, duration: 0.5, ease: out }],
    ["#maskcard", { opacity: [0, 1], scale: [0.92, 1] }, { at: 8.45, duration: 0.5, ease: out }],
    ["#cap2", { opacity: [0, 1], y: [30, 0] }, { at: 8.5, duration: 0.5, ease: out }],
    ["#scan", { x: [-200, 1000], opacity: [0, 1, 1, 0] }, { at: 9.0, duration: 1.4, ease: "linear" }],
    ...MASKED.flatMap((_, i) => [
      [`#orig${i}`, { opacity: [1, 0], x: [0, 30], filter: ["blur(0px)", "blur(6px)"] }, { at: 9.25 + i * 0.4, duration: 0.35, ease: "easeIn" }],
      [`#tok${i}`, { opacity: [0, 1], scale: [0.7, 1] }, { at: 9.4 + i * 0.4, duration: 0.4, ease: pop }],
    ]),
    ["#maskFoot", { opacity: [0, 1], y: [16, 0] }, { at: 10.5, duration: 0.4, ease: out }],

    // End card
    ["#end", { opacity: [0, 1] }, { at: 11.3, duration: 0.45, ease: out }],
    ["#endLogo", { opacity: [0, 1], scale: [0.5, 1] }, { at: 11.45, duration: 0.6, ease: pop }],
    [["#endName", "#endFull"], { opacity: [0, 1], y: [30, 0] }, { at: 11.65, duration: 0.5, delay: stagger(0.12), ease: out }],
    ["#endFree", { opacity: [0, 1], y: [20, 0] }, { at: 12.1, duration: 0.5, ease: out }],
    [["#endCmd", "#endOs"], { opacity: [0, 1], y: [20, 0] }, { at: 12.4, duration: 0.5, delay: stagger(0.15), ease: out }],
    // Hold the end card until DURATION (keeps the sequence as long as the video).
    ["#endOs", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

/** Wires draw in, then dots travel both ways (requests out, replies back). Pure function of t. */
function onFrame(t) {
  const draw = (w, a, b) => {
    w.p.style.strokeDashoffset = String(w.len * (1 - easeInOut(prog(t, a, b))));
  };
  appWires.forEach((w, i) => draw(w, 1.5 + i * 0.08, 2.2 + i * 0.08));
  svcWires.forEach((w, i) => draw(w, 2.4 + i * 0.06, 3.1 + i * 0.06));

  const alpha = prog(t, 3.0, 3.4);
  const place = (w, i, period, offset) => {
    w.dots.forEach((d, k) => {
      let f = (((t + offset + i * 0.23 + k * period * 0.5) / period) % 1 + 1) % 1;
      if (k === 1) f = 1 - f; // second dot runs back
      const pt = w.p.getPointAtLength(f * w.len);
      d.setAttribute("cx", pt.x);
      d.setAttribute("cy", pt.y);
      d.setAttribute("opacity", String(alpha * Math.min(1, 6 * Math.min(f, 1 - f)))); // fade at the ends
    });
  };
  appWires.forEach((w, i) => place(w, i, 1.6, 0));
  svcWires.forEach((w, i) => place(w, i, 1.4, 0.4));
}

// Hidden until their beat (Motion holds first keyframes before each segment starts).
for (const id of ["maskcard", "end", "boundary", "lockbadge", "maskFoot"]) $(id).style.opacity = "0";
for (const k of keyEls) k.style.opacity = "0";
for (let i = 0; i < 3; i++) $(`tok${i}`).style.opacity = "0";

stage({ duration: DURATION, build, onFrame });
