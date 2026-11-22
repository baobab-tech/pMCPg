// "Three audiences": 20 s short, mirroring the hero toggle on pmcpg.io (website/components/audience.tsx).
// Beats: new to connectors (0.5–6 s), I use connectors (6–11.5 s), IT teams (11.5–17 s), end card (17–20 s).
// The IT beat says only what works today; org-wide features are labelled "Coming".

import { $, LOGO, el, endCard, fade, winBar } from "../../lib/site.js";
import { FORMAT, easeInOut, prog, stage } from "../../lib/stage.js";

const { animate, stagger } = window.Motion;
const DURATION = 20;
const B = [0.5, 6.0, 11.5];
const END = 17.0;
const LAND = FORMAT === "landscape";

// ---- Content (website/components/audience.tsx, before-after.tsx, sections.tsx) ------------------

const TABS = ["New to connectors", "I use connectors", "IT teams"];
const COPY = [
  {
    h: "Let your AI app use your tools, safely.",
    p: 'pMCPg <mark class="hl" id="hl0">runs on your computer</mark>, holds your sign-ins and masks personal data in tool results.',
  },
  {
    h: "One connector that you control",
    p: "Import the ones you have. Each app connects once, to pMCPg. <b>Keys live in your keychain.</b>",
  },
  {
    h: "Control and monitor MCP usage of your teams.",
    p: "No cloud service, no account. <b><span style=\"white-space:nowrap\">Org-wide</span> management is coming.</b>",
  },
];
const STEPS = [
  { t: "Install pMCPg", b: "One line in a terminal." },
  { t: "Add a connector", b: "Paste its URL. Sign in once." },
  { t: "Connect your AI app", b: "One click per app." },
  { t: "Ask your AI", b: "Every call shows in the activity log." },
];
const CONNECTORS = [
  { name: "Figma", tile: "F", color: "#a259ff", status: "Signed in" },
  { name: "Linear", tile: "L", color: "#5e6ad2", status: "Sign-in expired", bad: true },
  { name: "Slack", tile: "S", color: "#7a4fd0", status: "Signed in" },
  { name: "Notion", tile: "N", color: "#6b6b6b", status: "API key in config file", bad: true },
  { name: "Research MCP", tile: "R", color: "#2f8f6f", status: "Token in config file", bad: true },
  { name: "OpenAlex", tile: "OA", color: "#c98a2e", status: "No sign-in" },
];
const TODAY = [
  "Profiles with their own URLs and tokens",
  "Presets: open, balanced, careful",
  "Approvals in the web UI",
  "Encrypted activity log",
  "Runs in Docker",
];
const COMING = ["Managed setup through MDM", "Org policy packs", "A team gateway on your own server"];

// ---- Build DOM -----------------------------------------------------------------------------------

const toggle = $("toggle");
const tabEls = TABS.map((label) => {
  const s = el("span", "", label);
  toggle.append(s);
  return s;
});

COPY.forEach((c, i) => {
  const b = el("div", "beat", `<h1>${c.h}</h1><p>${c.p}</p>`);
  b.id = `copy${i}`;
  $("copy").append(b);
});

const visual = $("visual");
const vis = (id, w, h, html, cls = "") => {
  const v = el("div", `vis ${cls}`, html);
  v.id = id;
  Object.assign(v.style, { width: `${w}px`, height: `${h}px`, marginLeft: `${-w / 2}px`, marginTop: `${-h / 2}px` });
  visual.append(v);
  return v;
};

// Beat 1
const v0 = vis(
  "v0",
  940,
  480,
  `<div class="steps">${STEPS.map((s, i) => `<div class="step" id="st${i}"><div class="n">Step ${i + 1}</div><h3>${s.t}</h3><p>${s.b}</p></div>`).join("")}</div>`,
);

// Beat 2: tilted stack, Claude Desktop in front
const bad = CONNECTORS.filter((c) => c.bad).length;
const v1 = vis(
  "v1",
  900,
  600,
  `<div class="plane" id="plane1">
    <div class="win ghost" id="g0" style="left:0;top:0;width:860px;height:120px">${winBar("VS Code · mcp.json", " ")}</div>
    <div class="win ghost" id="g1" style="left:20px;top:40px;width:860px;height:120px">${winBar("LM Studio · mcp.json", " ")}</div>
    <div class="win" id="cw" style="left:40px;top:82px;width:860px;height:518px">
      ${winBar("Claude Desktop · Connectors", `<span id="cstat"></span>`)}
      <div id="rows" style="position:absolute;left:0;right:0;top:60px;bottom:60px">
        ${CONNECTORS.map((c, i) => `<div class="conn-row" id="cr${i}" style="top:${i * 66}px"><span class="t" style="background:${c.color}">${c.tile}</span>${c.name}<span class="s${c.bad ? " bad" : ""}">${c.bad ? "⚠ " : ""}${c.status}</span></div>`).join("")}
        <div class="after" id="after">
          <div class="top"><span class="lg">${LOGO(46)}</span><div><b>pMCPg</b><div class="sub">Private MCP Gateway · on this computer</div></div><span class="ok">● all healthy</span></div>
          <div class="tags">${CONNECTORS.map((c, i) => `<span id="tag${i}">${c.name}</span>`).join("")}</div>
        </div>
      </div>
      <div class="foot2" id="foot2"></div>
    </div>
  </div>`,
  "persp",
);

// Beat 3
const v2 = vis(
  "v2",
  LAND ? 880 : 940,
  LAND ? 640 : 600,
  `<div class="teams">
    <div class="tcard today" id="today"><div class="k">Works today</div><ul>${TODAY.map((t, i) => `<li id="td${i}"><span class="c">✓</span>${t}</li>`).join("")}</ul></div>
    <div class="tcard coming" id="coming"><div class="k">Coming</div><ul>${COMING.map((t, i) => `<li id="cm${i}"><span class="d"></span>${t}</li>`).join("")}</ul></div>
  </div>`,
);

function fit() {
  const r = visual.getBoundingClientRect();
  for (const v of [v0, v1, v2]) {
    const w = Number.parseFloat(v.style.width);
    const h = Number.parseFloat(v.style.height);
    v.style.scale = String(Math.min(r.width / w, r.height / h, 1.2));
  }
}
fit();

const endSegs = endCard($("end"), { line: "For people new to connectors, people with many, and IT teams." }, END);

// ---- Timeline ------------------------------------------------------------------------------------

const out = "easeOut";

function build() {
  const beats = [0, 1, 2].flatMap((i) => {
    const a = B[i];
    const z = B[i + 1] ?? END;
    return [
      [`#copy${i}`, { opacity: [0, 1], y: [30, 0] }, { at: a + 0.1, duration: 0.45, ease: out }],
      [`#copy${i}`, { opacity: [1, 0], y: [0, -24] }, { at: z - 0.35, duration: 0.3, ease: "easeIn" }],
      [`#v${i}`, { opacity: [0, 1], y: [40, 0] }, { at: a + 0.3, duration: 0.5, ease: out }],
      [`#v${i}`, { opacity: [1, 0], y: [0, -30] }, { at: z - 0.35, duration: 0.3, ease: "easeIn" }],
    ];
  });
  return animate([
    ["#toggle", { opacity: [0, 1], y: [20, 0] }, { at: 0.05, duration: 0.45, ease: out }],
    ...beats,
    [STEPS.map((_, i) => `#st${i}`), { opacity: [0, 1], y: [24, 0] }, { at: B[0] + 0.45, duration: 0.4, delay: stagger(0.1), ease: out }],
    [TODAY.map((_, i) => `#td${i}`), { opacity: [0, 1], x: [-16, 0] }, { at: B[2] + 0.6, duration: 0.35, delay: stagger(0.14), ease: out }],
    ["#coming", { opacity: [0, 1], y: [20, 0] }, { at: B[2] + 1.5, duration: 0.45, ease: out }],
    [COMING.map((_, i) => `#cm${i}`), { opacity: [0, 1], x: [-16, 0] }, { at: B[2] + 1.8, duration: 0.35, delay: stagger(0.14), ease: out }],
    ...endSegs,
    ["#endUrl", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

function onFrame(t) {
  // Toggle knob slides between tabs (a short spring-like ease).
  const pos = (i) => ({ x: tabEls[i].offsetLeft, w: tabEls[i].offsetWidth });
  let k = 0;
  let from = 0;
  let p = 1;
  for (let i = 1; i < 3; i++) {
    if (t >= B[i] - 0.15) {
      from = i - 1;
      k = i;
      p = prog(t, B[i] - 0.15, B[i] + 0.3);
    }
  }
  const e = 1 - (1 - easeInOut(p)) ** 2;
  const a = pos(from);
  const b = pos(k);
  Object.assign($("knob").style, { left: `${a.x + (b.x - a.x) * e}px`, width: `${a.w + (b.w - a.w) * e}px` });
  tabEls.forEach((s, i) => {
    s.className = i === (p > 0.5 ? k : from) ? "on" : "";
  });

  // Beat 1: highlighter sweep, then the step highlight walks through the cards.
  $("hl0").style.setProperty("--hl", `${100 * easeInOut(prog(t, B[0] + 0.7, B[0] + 1.5))}%`);
  const walk = Math.floor((t - (B[0] + 1.3)) / 0.95);
  STEPS.forEach((_, i) => {
    const on = walk >= 0 && t < B[1] && walk % 4 === i;
    const st = $(`st${i}`);
    st.style.borderColor = on ? "#3db8d8" : "rgb(255 255 255 / 0.12)";
    st.style.boxShadow = on ? "0 0 0 1px #3db8d8, 0 0 44px -8px #3db8d8" : "none";
  });

  // Beat 2: the connector list folds into one pMCPg entry.
  const c0 = B[1] + 2.4;
  const shrink = easeInOut(prog(t, c0 + 0.2, c0 + 0.8));
  $("plane1").style.transform = `translateY(${40 * shrink}px) rotateX(${10 - 4 * easeInOut(prog(t, B[1], B[1] + 1))}deg) rotateY(${-8 + 3 * easeInOut(prog(t, B[1], B[1] + 4))}deg)`;
  CONNECTORS.forEach((_, i) => {
    const q = easeInOut(prog(t, c0 + i * 0.05, c0 + 0.45 + i * 0.05));
    const r = $(`cr${i}`);
    r.style.transform = `translateY(${-i * 66 * q}px) scale(${1 - 0.06 * q})`;
    r.style.opacity = String(1 - q);
    $(`tag${i}`).style.opacity = String(fade(t, c0 + 0.75 + i * 0.06, 0.25));
  });
  $("cw").style.height = `${518 - 140 * shrink}px`;
  $("after").style.opacity = String(fade(t, c0 + 0.45, 0.35));
  const after = t >= c0 + 0.3;
  $("cstat").innerHTML = after ? `<span style="color:var(--ok)">1 connector · all healthy</span>` : `<span class="bad">${CONNECTORS.length} connectors · ${bad} need attention</span>`;
  $("foot2").innerHTML = after
    ? `<span class="brand">The AI sees 2 tools and searches for the rest.</span>`
    : `<span class="bad">The AI loads every tool from every connector.</span>`;
  ["6 servers, keys copied in", "5 servers, keys copied in"].forEach((txt, i) => {
    $(`g${i}`).querySelector(".win-bar").lastChild.outerHTML = after
      ? `<span class="r ghostnote" style="color:var(--brand)">1 entry: pMCPg</span>`
      : `<span class="r ghostnote bad">${txt}</span>`;
  });
}

// Hidden until their beat.
$("toggle").style.opacity = "0";
for (const id of ["coming"]) $(id).style.opacity = "0";

// Played 1.35× slower than the times above: easier to read on a phone.
stage({ duration: DURATION, build, onFrame, slow: 1.35 });
