// "Connections that stay with you": 15 s short (board variation B).
// Beats: today your connections live inside one AI app (0–3.5 s), switching means setting up again
// (3.5–6.5 s), with pMCPg they live on your computer and every app uses them (6.5–11.5 s), end card (11.5–15 s).

import { ICONS, MARKS, SHIELD } from "../../lib/icons.js";
import { easeInOut, prog, stage } from "../../lib/stage.js";

const { animate, stagger } = window.Motion;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const NS = "http://www.w3.org/2000/svg";

const DURATION = 15;
const B3 = 6.6; // the "with pMCPg" beat starts here

// ---- Content ---------------------------------------------------------------------------------

const APPS = [
  { name: "Claude", tile: MARKS.claude(32), bg: "var(--claude)", wire: "#d97757" },
  { name: "ChatGPT", tile: MARKS.chatgpt(34), bg: "var(--chatgpt)", wire: "#10a37f" },
  { name: "Pi", tile: "Pi", bg: "#7c5cff", wire: "#a08cff" },
  { name: "VS Code", tile: MARKS.vscode(30), bg: "#007acc", wire: "#3ba7f0" },
  { name: "Any MCP app", tile: ICONS.plus, bg: "#404040", wire: "#a3a3a3" },
];
const SERVICES = [
  { name: "Notes", icon: ICONS.notes },
  { name: "Files", icon: ICONS.files },
  { name: "Issues", icon: ICONS.issues },
  { name: "Calendar", icon: ICONS.calendar },
  { name: "Email", icon: ICONS.mail },
  { name: "Database", icon: ICONS.database },
];
const SILOS = [
  [APPS[0], "Claude’s connectors"],
  [APPS[1], "ChatGPT’s connectors"],
  [APPS[2], "Pi’s MCP settings"],
];
const SILO_SVCS = [SERVICES[0], SERVICES[4], SERVICES[3]]; // Notes, Email, Calendar
const CAPTIONS = [
  { icon: ICONS.lock, text: "Each vendor manages<br>its own copy.", warn: true },
  { icon: ICONS.key, text: "One setup, on your computer.<br>Every app uses it." },
];

// ---- Geometry (diagram units, 1160×640) -----------------------------------------------------------

const appY = (i) => 64 + i * 128;
const svcY = (i) => 50 + i * 108;
const HUB_L = 445;
const HUB_R = 715;
const HUB_Y = 320;
const KEY_SLOTS = [470, 550, 630];
const KEY_FROM = [0, 4, 3]; // the keys come from Notes, Email, Calendar: the silo connectors

// ---- Build DOM ----------------------------------------------------------------------------------

$("eyebrow").innerHTML = `${SHIELD(30)} pMCPg`;
const diagram = $("diagram");
const wires = $("wires");

// Silos (beats 1–2)
$("silos").innerHTML = SILOS.map(
  ([a, label], i) => `<div class="silo" id="silo${i}">
    <div class="silo-app"><span class="tile" style="background:${a.bg}">${a.tile}</span><div>${a.name}<small>${label}</small></div><span class="silo-lock">${ICONS.lock}</span></div>
    <div class="silo-svcs">${SILO_SVCS.map((s) => `<span class="mini m${i}">${s.icon}${s.name}<span class="k">${ICONS.key}</span></span>`).join("")}</div>
    ${i > 0 ? `<span class="again" id="again${i}">set up again</span>` : ""}
  </div>`,
).join("");

// Diagram (beat 3)
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
  p.style.strokeDashoffset = `${len}`;
  return { p, len };
}
function dot(color) {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("r", "7");
  c.setAttribute("fill", color);
  c.setAttribute("opacity", "0");
  wires.append(c);
  return c;
}
const appWires = APPS.map((a, i) => ({
  ...wire(`M320 ${appY(i)} C 390 ${appY(i)}, 380 ${HUB_Y}, ${HUB_L} ${HUB_Y}`, a.wire, 0.55),
  dots: [dot(a.wire), dot("#3db8d8")],
}));
const svcWires = SERVICES.map((_, i) => ({
  ...wire(`M${HUB_R} ${HUB_Y} C 780 ${HUB_Y}, 770 ${svcY(i)}, 840 ${svcY(i)}`, "#3db8d8", 0.5),
  dots: [dot("#3db8d8"), dot("#9fe3f3")],
}));

CAPTIONS.forEach((c, i) => {
  const cap = el("div", "cap", `<span class="ic${c.warn ? " w" : ""}">${c.icon.replace(/width="24" height="24"/, 'width="46" height="46"')}</span><span>${c.text}</span>`);
  cap.id = `cap${i}`;
  $("caption").append(cap);
});

$("end").innerHTML = `
  <div class="logo" id="endLogo">${SHIELD(96)}</div>
  <div class="name" id="endName">pMCPg</div>
  <div class="full" id="endFull">Private MCP Gateway</div>
  <div class="tag" id="endTag">Your tools. Any AI app. No lock-in.</div>
  <div class="free" id="endFree">Free · runs on your computer</div>
  <div class="cmd" id="endCmd"><span class="p">$</span> curl -fsSL …/install.sh | sh</div>
  <div class="os" id="endOs">macOS · Linux · Windows</div>`;

/** Scale the diagram (1160×640) and the silos (940×560) to fit their grid cell. */
function fit() {
  const r = $("dwrap").getBoundingClientRect();
  diagram.style.scale = String(Math.min(r.width / 1160, r.height / 640));
  $("silos").style.scale = String(0.92 * Math.min(1, r.width / 940, r.height / 560)); // breathing room under the headline
}
fit();

// ---- Timeline -------------------------------------------------------------------------------------

const out = "easeOut";
const pop = [0.34, 1.4, 0.64, 1];
const headIn = (i, at) => [`#hd${i}`, { opacity: [0, 1], y: [40, 0] }, { at, duration: 0.55, ease: out }];
const headOut = (i, at) => [`#hd${i}`, { opacity: [1, 0], y: [0, -30] }, { at, duration: 0.3, ease: "easeIn" }];
const capIn = (i, at) => [`#cap${i}`, { opacity: [0, 1], y: [30, 0] }, { at, duration: 0.5, ease: out }];
const capOut = (i, at) => [`#cap${i}`, { opacity: [1, 0], y: [0, -30] }, { at, duration: 0.35, ease: "easeIn" }];

function build() {
  return animate([
    // B1: your connections live inside one AI app.
    // Frame 0 is already complete: LinkedIn shows it as the preview before play. Motion starts after it.
    [".m0 .k", { scale: [1, 1.5, 1] }, { at: 0.8, duration: 0.5, delay: stagger(0.2), ease: "easeInOut" }],
    ["#silo0", { scale: [1, 1.03, 1] }, { at: 0.7, duration: 0.8, ease: "easeInOut" }],
    [["#silo1", "#silo2"], { opacity: [0.3, 0.3] }, { at: 0, duration: 0.1 }],

    // B2: switch apps, start over
    headOut(0, 3.3),
    headIn(1, 3.55),
    capIn(0, 3.8),
    ["#silo1", { opacity: [0.3, 1] }, { at: 3.7, duration: 0.3 }],
    [".m1", { opacity: [0, 1], scale: [0.6, 1] }, { at: 3.9, duration: 0.35, delay: stagger(0.12), ease: pop }],
    ["#again1", { opacity: [0, 1], scale: [1.6, 1] }, { at: 4.4, duration: 0.3, ease: pop }],
    ["#silo2", { opacity: [0.3, 1] }, { at: 4.6, duration: 0.3 }],
    [".m2", { opacity: [0, 1], scale: [0.6, 1] }, { at: 4.8, duration: 0.35, delay: stagger(0.12), ease: pop }],
    ["#again2", { opacity: [0, 1], scale: [1.6, 1] }, { at: 5.3, duration: 0.3, ease: pop }],

    // B3: with pMCPg, they live with you
    headOut(1, B3 - 0.2),
    capOut(0, B3 - 0.2),
    ["#silos", { opacity: [1, 0], scale: [1, 0.85] }, { at: B3 - 0.2, duration: 0.45, ease: "easeIn" }],
    headIn(2, B3 + 0.1),
    [appEls, { opacity: [0, 1], x: [-50, 0] }, { at: B3 + 0.2, duration: 0.45, delay: stagger(0.07), ease: out }],
    [hub, { opacity: [0, 1], scale: [0.6, 1] }, { at: B3 + 0.4, duration: 0.55, ease: pop }],
    ["#boundary", { opacity: [0, 1], scale: [1.08, 1] }, { at: B3 + 0.6, duration: 0.45, ease: out }],
    [svcEls, { opacity: [0, 1], x: [50, 0] }, { at: B3 + 0.6, duration: 0.45, delay: stagger(0.06), ease: out }],
    capIn(1, B3 + 0.7),
    ...keyEls.map((k, i) => [
      k,
      { opacity: [0, 1, 1], x: [870 - KEY_SLOTS[i], 0], y: [svcY(KEY_FROM[i]) - 30 - 408, 0], scale: [0.6, 1] },
      { at: B3 + 1.5 + i * 0.18, duration: 0.8, ease: "easeInOut" },
    ]),
    ["#lockbadge", { opacity: [0, 1], scale: [0.3, 1] }, { at: B3 + 2.5, duration: 0.45, ease: pop }],

    // End card
    ["#end", { opacity: [0, 1] }, { at: 11.5, duration: 0.45, ease: out }],
    ["#endLogo", { opacity: [0, 1], scale: [0.5, 1] }, { at: 11.65, duration: 0.6, ease: pop }],
    [["#endName", "#endFull"], { opacity: [0, 1], y: [30, 0] }, { at: 11.85, duration: 0.5, delay: stagger(0.12), ease: out }],
    [["#endTag", "#endFree"], { opacity: [0, 1], y: [20, 0] }, { at: 12.25, duration: 0.5, delay: stagger(0.15), ease: out }],
    [["#endCmd", "#endOs"], { opacity: [0, 1], y: [20, 0] }, { at: 12.7, duration: 0.5, delay: stagger(0.15), ease: out }],
    ["#endOs", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

/** Wires draw in during beat 3, then dots run both ways. Pure function of t. */
function onFrame(t) {
  const draw = (w, a, b) => {
    w.p.style.strokeDashoffset = String(w.len * (1 - easeInOut(prog(t, a, b))));
  };
  appWires.forEach((w, i) => draw(w, B3 + 0.5 + i * 0.06, B3 + 1.1 + i * 0.06));
  svcWires.forEach((w, i) => draw(w, B3 + 0.8 + i * 0.05, B3 + 1.4 + i * 0.05));

  const alpha = prog(t, B3 + 1.3, B3 + 1.7);
  const place = (w, i, period, offset) => {
    w.dots.forEach((d, k) => {
      let f = ((((t + offset + i * 0.23 + k * period * 0.5) / period) % 1) + 1) % 1;
      if (k === 1) f = 1 - f;
      const pt = w.p.getPointAtLength(f * w.len);
      d.setAttribute("cx", pt.x);
      d.setAttribute("cy", pt.y);
      d.setAttribute("opacity", String(alpha * Math.min(1, 6 * Math.min(f, 1 - f))));
    });
  };
  appWires.forEach((w, i) => place(w, i, 1.6, 0));
  svcWires.forEach((w, i) => place(w, i, 1.4, 0.4));
}

// Hidden until their beat (Motion holds first keyframes before each segment starts).
// The opening state (eyebrow, first headline, Claude's card) stays visible from frame 0.
for (const sel of ["#end", "#boundary", "#lockbadge", "#hd1", "#hd2", ".m1", ".m2", ".again", ".pill", ".hub", ".keychip"])
  for (const n of document.querySelectorAll(sel)) n.style.opacity = "0";
for (const n of document.querySelectorAll("#silo1, #silo2")) n.style.opacity = "0.3";

stage({ duration: DURATION, build, onFrame });
