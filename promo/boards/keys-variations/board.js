// Draft-stills board: static key frames for five script variations. No animation; each frame is a pose.

import { ICONS, MARKS, SHIELD } from "../../lib/icons.js";

const big = (svg, n = 46) => svg.replace(/width="24" height="24"/, `width="${n}" height="${n}"`);

// ---- Diagram (same geometry as comps/keys-short) ------------------------------------------------

const APPS = [
  { name: "Claude", tile: MARKS.claude(32), bg: "#d97757", wire: "#d97757" },
  { name: "ChatGPT", tile: MARKS.chatgpt(34), bg: "#10a37f", wire: "#10a37f" },
  { name: "Pi", tile: "Pi", bg: "#7c5cff", wire: "#a08cff" },
  { name: "VS Code", tile: MARKS.vscode(30), bg: "#007acc", wire: "#3ba7f0" },
  { name: "Any MCP app", tile: ICONS.plus, bg: "#404040", wire: "#a3a3a3" },
];
const SERVICES = [
  ["Notes", ICONS.notes],
  ["Files", ICONS.files],
  ["Issues", ICONS.issues],
  ["Calendar", ICONS.calendar],
  ["Email", ICONS.mail],
  ["Database", ICONS.database],
];
const appY = (i) => 64 + i * 128;
const svcY = (i) => 50 + i * 108;

/**
 * mode: "hub" (via pMCPg) or "mesh" (every app wired to every service).
 * lit: app index to highlight (-1 none). vault: keys + lock inside "Your computer".
 * appKeys: a key badge on every app. appsOnly: just the app column.
 */
function dia({ mode = "hub", lit = -1, vault = false, appKeys = false, appsOnly = false } = {}) {
  let paths = "";
  if (!appsOnly && mode === "mesh") {
    APPS.forEach((_, a) =>
      SERVICES.forEach((_, s) => {
        paths += `<path d="M320 ${appY(a)} C 580 ${appY(a)}, 580 ${svcY(s)}, 840 ${svcY(s)}" stroke="#f0a35e" stroke-opacity="0.35" stroke-width="2" fill="none"/>`;
      }),
    );
  } else if (!appsOnly) {
    APPS.forEach((app, i) => {
      const on = lit === -1 || lit === i;
      paths += `<path d="M320 ${appY(i)} C 390 ${appY(i)}, 380 320, 445 320" stroke="${app.wire}" stroke-opacity="${lit === -1 ? 0.55 : on ? 1 : 0.12}" stroke-width="${lit === i ? 5 : 3}" fill="none"/>`;
      if (on) paths += `<circle cx="${lit === i ? 395 : 380}" cy="${lit === i ? (appY(i) + 320) / 2 : (appY(i) + 320) / 2}" r="7" fill="#3db8d8"/>`;
    });
    SERVICES.forEach((_, i) => {
      paths += `<path d="M715 320 C 780 320, 770 ${svcY(i)}, 840 ${svcY(i)}" stroke="#3db8d8" stroke-opacity="0.5" stroke-width="3" fill="none"/>`;
      paths += `<circle cx="790" cy="${(320 + svcY(i)) / 2}" r="7" fill="#9fe3f3"/>`;
    });
  }
  const apps = APPS.map((a, i) => {
    const cls = lit === -1 ? "" : lit === i ? " lit" : " dim";
    const key = appKeys ? `<span class="chip w" style="left:285px;top:12px;width:56px;height:56px">${ICONS.key}</span>` : "";
    return `<div class="pill${cls}" style="left:0;top:${appY(i) - 42}px"><span class="tile" style="background:${a.bg}">${a.tile}</span>${a.name}${key}</div>`;
  }).join("");
  if (appsOnly) return `<div class="dia">${apps}</div>`;
  const svcs = SERVICES.map(
    ([n, ic], i) => `<div class="pill svc" style="left:840px;top:${svcY(i) - 38}px"><span class="tile">${ic}</span>${n}</div>`,
  ).join("");
  const hub =
    mode === "hub"
      ? `${vault ? `<div class="boundary"><div class="label">${ICONS.laptop} Your computer</div></div>` : ""}
         <div class="hub">${SHIELD(56)}pMCPg${vault ? `<span class="lockbadge">${ICONS.lock}</span>` : ""}</div>
         ${vault ? [470, 550, 630].map((x) => `<span class="chip" style="left:${x}px;top:408px">${ICONS.key}</span>`).join("") : ""}`
      : "";
  return `<div class="dia"><svg viewBox="0 0 1160 640">${paths}</svg>${hub}${apps}${svcs}</div>`;
}

// ---- Frame parts ------------------------------------------------------------------------------------

const eyebrow = `<div class="eyebrow">${SHIELD(30)} pMCPg</div>`;
const cap = (icon, text, warn = false) =>
  `<div class="cap"><span class="ic${warn ? " w" : ""}">${big(icon)}</span><span>${text}</span></div>`;
const frame = (inner) => `<div class="frame"><div class="safe">${inner}</div></div>`;
const end = (tag) => `<div class="frame"><div class="end">
  <div class="logo">${SHIELD(96)}</div>
  <div class="name">pMCPg</div>
  <div class="full">Private MCP Gateway</div>
  <div class="tag">${tag}</div>
  <div class="free">Free · runs on your computer</div>
  <div class="cmd"><span class="p">$</span> curl -fsSL …/install.sh | sh</div>
  <div class="os">macOS · Linux · Windows</div></div></div>`;

/** Each AI app keeps its own connectors and logins, managed by that app's vendor. `dim` greys out all but one. */
const silos = ({ only = -1, again = false } = {}) => {
  const rows = [
    [APPS[0], "Claude’s connectors"],
    [APPS[1], "ChatGPT’s connectors"],
    [APPS[2], "Pi’s MCP settings"],
  ];
  const svcs = [SERVICES[0], SERVICES[4], SERVICES[3]];
  return `<div class="silos">${rows
    .map(
      ([a, label], i) => `<div class="silo${only !== -1 && only !== i ? " dim" : ""}">
        <div class="silo-app"><span class="tile" style="background:${a.bg}">${a.tile}</span><div><b>${a.name}</b><small>${label}</small></div><span class="silo-lock">${ICONS.lock}</span></div>
        <div class="silo-svcs">${svcs.map(([n, ic]) => `<span class="mini">${ic}${n}<span class="k">${ICONS.key}</span></span>`).join("")}</div>
        ${again && i > 0 ? `<span class="again">set up again</span>` : ""}
      </div>`,
    )
    .join("")}</div>`;
};

// ---- Variations ---------------------------------------------------------------------------------------
// Tone: positive. You stay in control of your keys and connections; no lock-in to one AI vendor.

const VARIANTS = [
  {
    id: "A",
    title: "Stay in control",
    len: "15 s · keys-short with a new hook",
    note: "The same motion as the current keys-short, with a positive hook. Keys go into pMCPg on your computer. Then each app lights up on the same setup.",
    frames: [
      ["A1 · 0–3 s · Hook", "The headline lands; apps slide in from the left.", frame(`${eyebrow}<div class="h1">Your AI tools,<br><span class="brand">your control.</span></div><div class="grow">${dia({ appsOnly: true })}</div>`)],
      ["A2 · 3–7.5 s · Your keys", "Keys fly from Notes, Issues and Email into the box marked Your computer. A lock pops on.", frame(`${eyebrow}<div class="h1">Your AI tools,<br><span class="brand">your control.</span></div><div class="grow">${dia({ vault: true })}</div>${cap(ICONS.key, "Your keys and logins stay on your computer.")}`)],
      ["A3 · 7.5–11.5 s · Any app", "One app at a time lights up: Claude, ChatGPT, Pi, VS Code. The services stay lit.", frame(`${eyebrow}<div class="h1">Your AI tools,<br><span class="brand">your control.</span></div><div class="grow">${dia({ vault: true, lit: 1 })}</div>${cap(ICONS.plug, "Set up once.<br>Use it from any AI app.")}`)],
      ["A4 · 11.5–15 s · End", "The end card holds for 3 s.", end("Stay in control. Use any AI app.")],
    ],
  },
  {
    id: "B",
    title: "Before / after: connections that stay with you",
    len: "15 s",
    note: "The problem is lock-in. Each AI app keeps its own connectors and logins, managed by its vendor. Switching means setting everything up again. pMCPg moves them to your side.",
    frames: [
      ["B1 · 0–3.5 s · Today", "Claude's card fills with connectors. The other apps stay greyed out.", frame(`${eyebrow}<div class="h1">Your connections<br>live inside <span class="warn">one AI app.</span></div><div class="grow">${silos({ only: 0 })}</div>`)],
      ["B2 · 3.5–6.5 s · Switching", "ChatGPT and Pi fill with the same connectors, each stamped “set up again”.", frame(`${eyebrow}<div class="h1">Switch apps?<br><span class="warn">Start over.</span></div><div class="grow">${silos({ again: true })}</div>${cap(ICONS.lock, "Each vendor manages its own copy.", true)}`)],
      ["B3 · 6.5–11.5 s · With pMCPg", "The cards collapse into pMCPg. Keys drop into the vault; every app connects once.", frame(`${eyebrow}<div class="h1">With <span class="brand">pMCPg</span>,<br>they live with you.</div><div class="grow">${dia({ vault: true })}</div>${cap(ICONS.key, "One setup, on your computer. Every app uses it.")}`)],
      ["B4 · 11.5–15 s · End", "", end("Your tools. Any AI app. No lock-in.")],
    ],
  },
  {
    id: "C",
    title: "Trying a new AI app?",
    len: "12 s · portability first",
    note: "Leads with switching apps. Owning your keys comes second, as the reason switching is easy.",
    frames: [
      ["C1 · 0–2.5 s · Hook", "The question, then the subline.", frame(`${eyebrow}<div class="h1">Trying a new<br><span class="brand">AI app?</span></div><div class="sub">Bring your tools, logins<br>and keys with you.</div><div class="grow">${dia({ appsOnly: true })}</div>`)],
      ["C2 · 2.5–5.5 s · Set up once", "Only Claude is lit. pMCPg and the services build.", frame(`${eyebrow}<div class="h1">Trying a new<br><span class="brand">AI app?</span></div><div class="grow">${dia({ lit: 0, vault: true })}</div>${cap(ICONS.plug, "Your tools are set up once, in pMCPg.")}`)],
      ["C3 · 5.5–9 s · Switch", "The light hops from Claude to Pi, ChatGPT and VS Code. Each one says Connected.", frame(`${eyebrow}<div class="h1">Trying a new<br><span class="brand">AI app?</span></div><div class="grow">${dia({ lit: 2, vault: true })}</div>${cap(ICONS.arrowRight, "Same tools in every app. Nothing to redo.")}`)],
      ["C4 · 9–12 s · End", "", end("Set up once. Use any AI app. No lock-in.")],
    ],
  },
  {
    id: "D",
    title: "Who holds your connections?",
    len: "14 s",
    note: "A question hook. Show your connections spread across vendors’ connector managers, then brought home to one place you control.",
    frames: [
      ["D1 · 0–2.5 s · Hook", "The question types on.", frame(`${eyebrow}<div class="h1">Who holds your<br><span class="brand">AI connections?</span></div>`)],
      ["D2 · 2.5–6 s · Spread out", "Three vendor cards fill with the same connectors and logins.", frame(`${eyebrow}<div class="h1">Today: <span class="warn">each AI app.</span></div><div class="grow">${silos()}</div>${cap(ICONS.lock, "Managed by each vendor. Hard to leave.", true)}`)],
      ["D3 · 6–10.5 s · Bring them home", "The connectors fly out of the cards into pMCPg. A lock pops on the hub.", frame(`${eyebrow}<div class="h1">With pMCPg:<br><span class="brand">you do.</span></div><div class="grow">${dia({ vault: true })}</div>${cap(ICONS.key, "One place, on your computer. Every AI app connects to it.")}`)],
      ["D4 · 10.5–14 s · End", "", end("Stay in control of your connections.")],
    ],
  },
  {
    id: "E",
    title: "Kinetic type",
    len: "10 s · cheapest to make, text only",
    note: "No diagram, just big words cutting on the beat. Works as a fast hook or as an intro to A or C.",
    frames: [
      ["E1 · 0–1.5 s", "A hard cut on each line.", frame(`<div class="grow" style="display:flex;align-items:center"><div class="h1 xl">Your keys.<br>Your tools.</div></div>`)],
      ["E2 · 1.5–3 s", "“Any AI app.” pops in cyan.", frame(`<div class="grow" style="display:flex;align-items:center"><div class="h1 xl"><span class="brand">Any<br>AI app.</span></div></div>`)],
      ["E3 · 3–7 s", "The statement, then the subline.", frame(`${eyebrow}<div class="grow" style="display:flex;flex-direction:column;justify-content:center"><div class="h1">pMCPg keeps your connections on <span class="brand">your computer</span>, not inside one AI app.</div><div class="sub">Claude, ChatGPT, Pi and VS Code all connect to it.</div></div>`)],
      ["E4 · 7–10 s · End", "", end("Stay in control. No lock-in.")],
    ],
  },
];

document.getElementById("board").innerHTML = VARIANTS.map(
  (v) => `<section class="variant">
    <div class="vhead"><span class="id">${v.id}</span><h2>${v.title}</h2><span class="len">${v.len}</span></div>
    <p class="vnote">${v.note}</p>
    <div class="frames">${v.frames
      .map(([t, d, html]) => `<div class="cell"><div class="thumb">${html}</div><div class="t">${t}</div><div class="d">${d}</div></div>`)
      .join("")}</div>
  </section>`,
).join("");
