// "Your AI tools, your control": 15 s short.
// Beats: hook + apps → pMCPg → services (0–3 s), keys go to pMCPg's vault, never to the apps (3–7.8 s),
// portability: one setup, any AI app (7.8–11.6 s), end card with the install line (11.6–15 s).

import { ICONS, MARKS, SHIELD } from "../../lib/icons.js";
import { easeInOut, prog, stage } from "../../lib/stage.js";

const { animate, stagger } = window.Motion;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const NS = "http://www.w3.org/2000/svg";

const DURATION = 15;
const SWITCH = { from: 8.0, to: 11.6, step: 0.6 }; // portability beat: one app lit at a time

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
const CAPTIONS = [
  { icon: ICONS.key, text: "Your keys and logins stay on your computer." },
  { icon: ICONS.lock, text: "Not locked inside<br>one AI app." },
  { icon: ICONS.plug, text: "Set up once.<br>Use it from any AI app." },
  { icon: ICONS.arrowRight, text: "Switch apps anytime.<br>No redo, no lock-in." },
];

// ---- Geometry (diagram units, 1160×640) -----------------------------------------------------------

const appY = (i) => 64 + i * 128;
const svcY = (i) => 50 + i * 108;
const HUB_L = 445;
const HUB_R = 715;
const HUB_Y = 320;
const KEY_SLOTS = [470, 550, 630]; // chip x inside the "Your computer" box, y = 408
const KEY_FROM = [0, 2, 4]; // services the keys come from

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
  return { p, len, opacity };
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

$("end").innerHTML = `
  <div class="logo" id="endLogo">${SHIELD(96)}</div>
  <div class="name" id="endName">pMCPg</div>
  <div class="full" id="endFull">Private MCP Gateway</div>
  <div class="tag" id="endTag">Stay in control. Use any AI app.</div>
  <div class="free" id="endFree">Free · runs on your computer</div>
  <div class="cmd" id="endCmd"><span class="p">$</span> curl -fsSL …/install.sh | sh</div>
  <div class="os" id="endOs">macOS · Linux · Windows</div>`;

/** Scale the 1160×640 diagram to fit its grid cell. */
function fit() {
  const r = $("dwrap").getBoundingClientRect();
  diagram.style.scale = String(Math.min(r.width / 1160, r.height / 640));
}
fit();

// ---- Timeline -------------------------------------------------------------------------------------

const out = "easeOut";
const pop = [0.34, 1.4, 0.64, 1]; // slight overshoot
const capIn = (i, at) => [`#cap${i}`, { opacity: [0, 1], y: [30, 0] }, { at, duration: 0.5, ease: out }];
const capOut = (i, at) => [`#cap${i}`, { opacity: [1, 0], y: [0, -30] }, { at, duration: 0.35, ease: "easeIn" }];

function build() {
  return animate([
    // Hook
    ["#eyebrow", { opacity: [0, 1], y: [20, 0] }, { at: 0.1, duration: 0.5, ease: out }],
    ["#h1a", { opacity: [0, 1], y: [40, 0] }, { at: 0.2, duration: 0.6, ease: out }],
    ["#h1b", { opacity: [0, 1], y: [40, 0], scale: [0.9, 1] }, { at: 0.5, duration: 0.6, ease: pop }],

    // Apps → pMCPg → services
    [appEls, { opacity: [0, 1], x: [-50, 0] }, { at: 0.8, duration: 0.5, delay: stagger(0.1), ease: out }],
    [hub, { opacity: [0, 1], scale: [0.6, 1] }, { at: 1.4, duration: 0.6, ease: pop }],
    [svcEls, { opacity: [0, 1], x: [50, 0] }, { at: 2.0, duration: 0.5, delay: stagger(0.08), ease: out }],

    // Keys go into the vault on your computer, never to the apps
    capIn(0, 3.0),
    ["#boundary", { opacity: [0, 1], scale: [1.08, 1] }, { at: 3.2, duration: 0.5, ease: out }],
    ...keyEls.map((k, i) => [
      k,
      { opacity: [0, 1, 1], x: [870 - KEY_SLOTS[i], 0], y: [svcY(KEY_FROM[i]) - 30 - 408, 0], scale: [0.6, 1] },
      { at: 3.5 + i * 0.2, duration: 0.85, ease: "easeInOut" },
    ]),
    ["#lockbadge", { opacity: [0, 1], scale: [0.3, 1] }, { at: 4.6, duration: 0.45, ease: pop }],
    capOut(0, 5.3),
    capIn(1, 5.5),
    capOut(1, 7.6),

    // Portability
    capIn(2, 7.8),
    capOut(2, 9.7),
    capIn(3, 9.9),

    // End card
    ["#end", { opacity: [0, 1] }, { at: 11.6, duration: 0.45, ease: out }],
    ["#endLogo", { opacity: [0, 1], scale: [0.5, 1] }, { at: 11.75, duration: 0.6, ease: pop }],
    [["#endName", "#endFull"], { opacity: [0, 1], y: [30, 0] }, { at: 11.95, duration: 0.5, delay: stagger(0.12), ease: out }],
    [["#endTag", "#endFree"], { opacity: [0, 1], y: [20, 0] }, { at: 12.35, duration: 0.5, delay: stagger(0.15), ease: out }],
    [["#endCmd", "#endOs"], { opacity: [0, 1], y: [20, 0] }, { at: 12.8, duration: 0.5, delay: stagger(0.15), ease: out }],
    ["#endOs", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

/** Which app is lit during the portability beat, or -1 outside it. */
function activeApp(t) {
  if (t < SWITCH.from || t >= SWITCH.to) return -1;
  return Math.floor((t - SWITCH.from) / SWITCH.step) % APPS.length;
}

/** Wires draw in, dots travel both ways; in the portability beat only the lit app's wire carries traffic. */
function onFrame(t) {
  const draw = (w, a, b) => {
    w.p.style.strokeDashoffset = String(w.len * (1 - easeInOut(prog(t, a, b))));
  };
  appWires.forEach((w, i) => draw(w, 1.5 + i * 0.08, 2.2 + i * 0.08));
  svcWires.forEach((w, i) => draw(w, 2.1 + i * 0.06, 2.8 + i * 0.06));

  const lit = activeApp(t);
  appWires.forEach((w, i) => {
    const on = lit === -1 || lit === i;
    w.p.setAttribute("stroke-opacity", String(lit === -1 ? w.opacity : on ? 1 : 0.12));
    w.p.setAttribute("stroke-width", lit === i ? "5" : "3");
    appEls[i].style.borderColor = lit === i ? "var(--brand)" : "";
    appEls[i].style.filter = on ? "" : "brightness(0.45)"; // filter, not opacity: Motion owns opacity
  });

  const alpha = prog(t, 2.9, 3.3);
  const place = (w, i, period, offset, a) => {
    w.dots.forEach((d, k) => {
      let f = ((((t + offset + i * 0.23 + k * period * 0.5) / period) % 1) + 1) % 1;
      if (k === 1) f = 1 - f; // second dot runs back
      const pt = w.p.getPointAtLength(f * w.len);
      d.setAttribute("cx", pt.x);
      d.setAttribute("cy", pt.y);
      d.setAttribute("opacity", String(a * Math.min(1, 6 * Math.min(f, 1 - f)))); // fade at the ends
    });
  };
  appWires.forEach((w, i) => place(w, i, 1.6, 0, lit === -1 || lit === i ? alpha : 0));
  svcWires.forEach((w, i) => place(w, i, 1.4, 0.4, alpha));
}

// Hidden until their beat (Motion holds first keyframes before each segment starts).
for (const id of ["end", "boundary", "lockbadge"]) $(id).style.opacity = "0";
for (const k of keyEls) k.style.opacity = "0";

stage({ duration: DURATION, build, onFrame });
