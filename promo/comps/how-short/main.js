// "How it works": 19 s short, the website's live example as video.
// One request from Claude, through pMCPg, to two connectors and back, on the site's tilted 3D layers.
// Beats: intro (0–2.3 s), you ask (2.3–4.1), search (4.1–7.1), DevExplorer call (7.1–10.4),
// CRM call with masking (10.4–13.6), answer and log (13.6–16.2), end card (16.2–19).

import { ICONS } from "../../lib/icons.js";
import { $, LOGO, boxIn, curve, el, endCard, fade, movePacket, stateAt, typeInto, winBar } from "../../lib/site.js";
import { FORMAT, easeInOut, prog, stage } from "../../lib/stage.js";

const { animate, stagger } = window.Motion;
const NS = "http://www.w3.org/2000/svg";
const DURATION = 19;
const END = 16.2;
const LAYOUT = FORMAT === "landscape" ? "H" : "V";
document.documentElement.dataset.layout = LAYOUT;

// ---- Content (website/components/live-example.tsx) --------------------------------------------

const Q = "Which health projects in Kenya publish IATI data, and who do we know at their funders?";
const STEPS = ["You ask", "Search", "DevExplorer", "CRM", "Answer"];
const STEP_AT = [2.3, 4.1, 7.1, 10.4, 13.6];
const CAPTIONS = [
  { at: 0.4, text: "Follow one request from Claude, through <b>pMCPg</b>, and back." },
  { at: 2.3, text: "You ask Claude a question that needs <b>two connectors</b>." },
  { at: 4.1, text: "Claude sees <b>2 tools</b>. pMCPg returns only the ones that match." },
  { at: 7.1, text: 'pMCPg <b>adds your saved <span style="white-space:nowrap">sign-in</span></b>. Claude never sees the key.' },
  { at: 10.4, text: `<span class="w">jane@funder.org</span> becomes <b>[EMAIL_1]</b> before the cloud model reads it.` },
  { at: 13.6, text: "The activity log keeps <b>tool names and outcomes</b>, not the data." },
];

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ROWS = [
  { id: "search", name: "Search", icon: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>') },
  { id: "rule", name: "Rules", icon: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>') },
  { id: "key", name: "Sign-in", icon: ICONS.key.replace(/width="24" height="24"/, 'width="22" height="22"') },
  { id: "mask", name: "Mask", icon: ICONS.eyeOff.replace(/width="24" height="24"/, 'width="22" height="22"') },
  { id: "log", name: "Log", icon: svg('<path d="M3 6h18M3 12h18M3 18h12"/>') },
];
const SERVERS = [
  { id: "dev", name: "DevExplorer MCP", desc: "IATI aid data" },
  { id: "crm", name: "CRM MCP", desc: "Your contacts · custom" },
  { id: "oa", name: "OpenAlex MCP", desc: "Research papers" },
];

// Row and server states over time: [time, [state, text]].
const ROW_EVENTS = {
  search: [[5.0, ["on", "2 matches"]], [6.4, ["did", "2 matches"]]],
  rule: [[7.8, ["on", "read-only · allowed"]], [8.3, ["did", "read-only · allowed"]], [10.95, ["on", "read-only · allowed"]], [11.3, ["did", "read-only · allowed"]]],
  key: [[8.3, ["on", "saved sign-in added"]], [8.8, ["did", "saved sign-in added"]]],
  mask: [[12.5, ["on", "1 email → [EMAIL_1]"]], [13.2, ["did", "1 email → [EMAIL_1]"]]],
  log: [[13.7, ["on", "1 search · 2 calls"]], [15.4, ["did", "1 search · 2 calls"]]],
};
const SRV_EVENTS = {
  dev: [[9.5, ["on", "3 activities"]], [10.0, ["did", "3 activities"]]],
  crm: [[11.9, ["on", "2 contacts"]], [12.4, ["did", "2 contacts"]]],
  oa: [[5.2, ["hid", "no match: left out"]]],
};
const CHIPS = [
  { label: "search_tools", show: 4.15, done: 6.4 },
  { label: "call_tool · DevExplorer MCP", show: 7.15, done: 10.35 },
  { label: "call_tool · CRM MCP", show: 10.45, done: 13.5 },
];
// Packets: wire, label, start, end, back, raw.
const PACKETS = [
  ["app", "search: IATI projects, contacts", 4.2, 5.0],
  ["app", "DevExplorer MCP, CRM MCP", 5.6, 6.4, true],
  ["app", "call: DevExplorer MCP", 7.15, 7.8],
  ["dev", "🔑 search activities", 8.85, 9.5],
  ["dev", "3 activities", 9.55, 10.0, true],
  ["app", "3 activities", 9.95, 10.4, true],
  ["app", "call: CRM MCP", 10.45, 10.95],
  ["crm", "find contacts", 11.3, 11.9],
  ["crm", "jane@funder.org", 11.95, 12.5, true, true],
  ["app", "[EMAIL_1]", 12.8, 13.4, true],
];

// ---- Geometry: V for portrait and square, H for landscape --------------------------------------

const G = {
  V: {
    size: [960, 956],
    ghosts: [[0, 0, 920, 290], [20, 30, 920, 290]],
    chat: [40, 60, 920, 290],
    gw: [100, 430, 760, 336],
    servers: [[0, 846, 304, 110], [328, 846, 304, 110], [656, 846, 304, 110]],
    // Camera boxes [x, y, w, h] in scene units, from time t.
    cam: [[0, [-20, 0, 1000, 956]], [2.3, [-20, 40, 1000, 730]], [7.0, [-20, 340, 1000, 640]], [13.5, [-20, 40, 1000, 730]]],
  },
  H: {
    size: [1800, 530],
    ghosts: [[0, 0, 620, 420], [20, 35, 620, 420]],
    chat: [40, 70, 620, 420],
    gw: [770, 87, 540, 386],
    servers: [[1400, 35, 400, 136], [1400, 212, 400, 136], [1400, 389, 400, 136]],
    cam: [[0, [0, 0, 1800, 530]]],
  },
}[LAYOUT];

const place = (node, [x, y, w, h]) => Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });

// ---- Build DOM -----------------------------------------------------------------------------------

$("eyebrow").innerHTML = `${LOGO(36)} How it works`;
$("tracker").innerHTML = STEPS.map((s, i) => `<div id="tr${i}">${i + 1}<b>${s}</b></div>`).join("");
if (FORMAT === "square") $("note").style.display = "none";

const persp = $("persp");
const plane = $("plane");
const wires = $("wires");
Object.assign(persp.style, { width: `${G.size[0]}px`, height: `${G.size[1]}px` });
wires.setAttribute("viewBox", `0 0 ${G.size[0]} ${G.size[1]}`);

const ghostEls = ["LM Studio", "VS Code"].map((name, i) => {
  const g = el("div", "win ghost", winBar(name));
  place(g, G.ghosts[i]);
  if (i === 0) g.style.opacity = "0.6";
  plane.append(g);
  return g;
});

const chat = el(
  "div",
  "win chat",
  `${winBar("Claude Desktop", "cloud model")}
  <div class="body">
    <div class="bubble" id="q"></div>
    <div class="lower">
      <div class="chips" id="chips">${CHIPS.map((c, i) => `<span class="chip" id="chip${i}"><span class="g">⚙</span>${c.label}<span class="ok" id="chipok${i}">✓</span></span>`).join("")}</div>
      <div class="answer" id="ans">3 health projects in Kenya publish IATI data. Your contact at the lead funder: <span class="tok">[EMAIL_1]</span></div>
    </div>
  </div>`,
);
place(chat, G.chat);
plane.append(chat);

const gwz = el("div", "gwz");
place(gwz, G.gw);
const gw = el(
  "div",
  "win gw",
  `<div class="head">${LOGO(34)}<b>pMCPg</b><mark class="hl" id="hl">Runs on your computer</mark></div>
  <div class="rows">${ROWS.map((r) => `<div class="row" id="r-${r.id}"><span class="ic">${r.icon}</span><span>${r.name}</span><span class="st">—</span></div>`).join("")}</div>
  ${LAYOUT === "H" ? `<div class="foot">The AI sees 2 tools: <code>search_tools</code><code>call_tool</code></div>` : ""}`,
);
gwz.append(gw);
plane.append(gwz);

const srvEls = SERVERS.map((s, i) => {
  const n = el("div", "win srv", `<div class="n"><i></i>${s.name}</div><div class="d">${s.desc}</div><div class="r"></div>`);
  n.id = `s-${s.id}`;
  place(n, G.servers[i]);
  plane.append(n);
  return n;
});

CAPTIONS.forEach((c, i) => {
  const step = i === 0 ? "How it works" : `Step ${i} · ${STEPS[i - 1]}`;
  const cap = el("div", "cap", `<span class="step">${step}</span><span class="tx">${c.text}</span>`);
  cap.id = `cap${i}`;
  $("caption").append(cap);
});

/** Camera: scales and moves the scene so the box for time t fills the grid cell. */
const cell = $("swrap").getBoundingClientRect();
function camera(t) {
  const boxAt = (i) => G.cam[i][1];
  let i = 0;
  for (let k = 0; k < G.cam.length; k++) if (t >= G.cam[k][0]) i = k;
  const p = i === 0 ? 1 : easeInOut(prog(t, G.cam[i][0], G.cam[i][0] + 0.8));
  const a = boxAt(Math.max(0, i - 1));
  const b = boxAt(i);
  const [x, y, w, h] = a.map((v, k) => v + (b[k] - v) * p);
  const s = Math.min(cell.width / w, cell.height / h);
  persp.style.scale = String(s);
  persp.style.translate = `${cell.width / 2 - (x + w / 2) * s}px ${cell.height / 2 - (y + h / 2) * s}px`;
}

// Wires, from element boxes (offsets ignore the 3D transform).
const W = {};
function layoutWires() {
  const vert = LAYOUT === "V";
  const c = boxIn(chat, plane);
  const g = { x: G.gw[0], y: G.gw[1], w: G.gw[2], h: G.gw[3] };
  W.app = vert ? curve([c.x + c.w / 2, c.y + c.h], [g.x + g.w / 2, g.y], true) : curve([c.x + c.w, c.y + c.h / 2], [g.x, g.y + g.h / 2], false);
  SERVERS.forEach((s, i) => {
    const b = boxIn(srvEls[i], plane);
    W[s.id] = vert ? curve([g.x + g.w / 2, g.y + g.h], [b.x + b.w / 2, b.y], true) : curve([g.x + g.w, g.y + g.h / 2], [b.x, b.y + b.h / 2], false);
  });
  for (const [k, d] of Object.entries(W)) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-width", "2.5");
    if (k === "oa") p.setAttribute("stroke-dasharray", "6 9");
    wires.append(p);
    W[k] = { p, len: p.getTotalLength() };
  }
}
layoutWires();

const pkEls = PACKETS.map(([, label, , , , raw]) => {
  const pk = el("div", `pk${raw ? " raw" : ""}`, label);
  plane.append(pk);
  return pk;
});

const endSegs = endCard($("end"), { line: "Free and open source. Runs on your computer." }, END);

// ---- Timeline ------------------------------------------------------------------------------------

const out = "easeOut";
const pop = [0.34, 1.4, 0.64, 1];

function build() {
  const caps = CAPTIONS.flatMap((c, i) => {
    const next = CAPTIONS[i + 1]?.at ?? END;
    return [
      [`#cap${i}`, { opacity: [0, 1], y: [24, 0] }, { at: c.at, duration: 0.4, ease: out }],
      [`#cap${i}`, { opacity: [1, 0], y: [0, -20] }, { at: next - 0.3, duration: 0.25, ease: "easeIn" }],
    ];
  });
  return animate([
    ["#eyebrow", { opacity: [0, 1], y: [16, 0] }, { at: 0.05, duration: 0.45, ease: out }],
    ["#note", { opacity: [0, 1] }, { at: 0.3, duration: 0.4, ease: out }],
    [STEPS.map((_, i) => `#tr${i}`), { opacity: [0, 1], y: [12, 0] }, { at: 0.2, duration: 0.4, delay: stagger(0.06), ease: out }],
    [ghostEls[0], { opacity: [0, 0.6], y: [30, 0] }, { at: 0.3, duration: 0.5, ease: out }],
    [ghostEls[1], { opacity: [0, 1], y: [30, 0] }, { at: 0.38, duration: 0.5, ease: out }],
    [chat, { opacity: [0, 1], y: [30, 0] }, { at: 0.45, duration: 0.5, ease: out }],
    [gw, { opacity: [0, 1], scale: [0.85, 1] }, { at: 0.75, duration: 0.55, ease: pop }],
    [srvEls, { opacity: [0, 1], y: [30, 0] }, { at: 1.0, duration: 0.5, delay: stagger(0.08), ease: out }],
    ...caps,
    ...endSegs,
    ["#endUrl", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

function onFrame(t) {
  camera(t);
  // Tilt: starts steep, settles, then drifts a little (the site tilts with the pointer).
  const s = easeInOut(prog(t, 0, 2.2));
  const rx = 22 - 14 * s;
  const ry = (LAYOUT === "H" ? -12 : -8) + (LAYOUT === "H" ? 7 : 5) * s + 1.5 * Math.sin(t * 0.45) * s;
  plane.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  plane.style.transformOrigin = "50% 50%";

  // Wires draw in, then light up while a packet is on them.
  const busy = {};
  PACKETS.forEach(([w, , a, b, back], i) => {
    if (movePacket(pkEls[i], W[w].p, W[w].len, t, a, b, back)) busy[w] = true;
  });
  Object.entries(W).forEach(([k, w], i) => {
    const d = easeInOut(prog(t, 1.2 + i * 0.1, 1.9 + i * 0.1));
    w.p.style.strokeDasharray = k === "oa" ? "6 9" : `${w.len}`;
    w.p.style.strokeDashoffset = k === "oa" ? "0" : String(w.len * (1 - d));
    w.p.style.opacity = k === "oa" ? String(d) : "1";
    w.p.setAttribute("stroke", busy[k] ? "#3db8d8" : "rgb(255 255 255 / 0.22)");
  });

  // Chat
  typeInto($("q"), Q, t, 2.45, 62);
  $("q").style.opacity = t < 2.4 ? "0" : "1";
  CHIPS.forEach((c, i) => {
    const chip = $(`chip${i}`);
    chip.style.opacity = String(fade(t, c.show, 0.25));
    $(`chipok${i}`).style.opacity = t >= c.done ? "1" : "0";
  });
  $("ans").style.opacity = String(fade(t, 13.75, 0.5));
  $("chips").style.opacity = String(1 - fade(t, 13.6, 0.3));

  // Gateway rows and servers
  for (const r of ROWS) {
    const [st, txt] = stateAt(t, ROW_EVENTS[r.id], ["", "—"]);
    const row = $(`r-${r.id}`);
    row.className = `row ${st}`;
    row.querySelector(".st").textContent = txt;
  }
  for (const s of SERVERS) {
    const [st, txt] = stateAt(t, SRV_EVENTS[s.id], ["", ""]);
    const n = $(`s-${s.id}`);
    n.className = `win srv ${st}`;
    n.querySelector(".r").textContent = txt;
  }
  $("hl").style.setProperty("--hl", `${100 * easeInOut(prog(t, 1.4, 2.2))}%`);

  // Tracker
  STEPS.forEach((_, i) => {
    const tr = $(`tr${i}`);
    const cur = t >= STEP_AT[i] && (i === STEPS.length - 1 || t < STEP_AT[i + 1]);
    const done = i < STEPS.length - 1 && t >= STEP_AT[i + 1];
    tr.style.borderTopColor = cur ? "#3db8d8" : done ? "rgb(61 184 216 / 0.4)" : "rgb(255 255 255 / 0.12)";
    tr.style.color = cur ? "#fafafa" : done ? "#a1a1a1" : "rgb(161 161 161 / 0.6)";
  });
}

// Hidden until their beat.
for (const id of ["eyebrow", "note"]) $(id).style.opacity = "0";
for (const n of [...ghostEls, chat, gw, ...srvEls]) n.style.opacity = "0";

// Played 1.35× slower than the times above: easier to read on a phone.
stage({ duration: DURATION, build, onFrame, slow: 1.35 });
