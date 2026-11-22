// "Get it in one line": 17 s short. The install moment from pmcpg.io's Download section.
// Beats: the one-line installer in a terminal (0–5.8 s), the web UI opens and you add a connector by URL
// (5.8–9.8 s), connect your AI apps (9.8–13.8 s), end card (13.8–17 s).
// Terminal lines are the installer's own messages (packaging/install/install.sh, `pmcpg open`).

import { ICONS, MARKS } from "../../lib/icons.js";
import { $, LOGO, el, endCard, fade, typeInto, winBar } from "../../lib/site.js";
import { easeInOut, prog, stage } from "../../lib/stage.js";

const { animate } = window.Motion;
const DURATION = 17;
const B2 = 5.8;
const B3 = 9.8;
const END = 13.8;

// ---- Content ---------------------------------------------------------------------------------

const CMD = "curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh";
const OUT = [
  { at: 3.25, html: "pmcpg: Downloading the latest release for darwin-arm64" },
  { at: 3.75, html: 'pmcpg: <span class="okc">Checksum verified</span>' },
  { at: 4.2, html: "pmcpg: Installed pmcpg 0.1.4 to /Users/you/.local/bin/pmcpg" },
  { at: 4.75, html: "Opening the web UI in your browser." },
];
const URL = "https://mcp.linear.app/mcp";
const APPS = [
  { name: "Claude Desktop", sub: "Desktop app", tile: MARKS.claude(32), bg: "var(--claude)" },
  { name: "Claude Code", sub: "Terminal", tile: MARKS.claude(32), bg: "#262626" },
  { name: "VS Code", sub: "Editor", tile: MARKS.vscode(30), bg: "#007acc" },
  { name: "LM Studio", sub: "Local models", tile: "LM", bg: "#4b3fbf" },
];
const CONNECT_AT = [10.7, 11.15, 11.6, 12.05];
const CAPTIONS = [
  { at: 0.9, text: "Paste one line into a terminal. It <b>checks the download</b> and starts pMCPg at login." },
  { at: B2 + 0.1, text: "The web UI opens. <b>Paste a connector's URL</b>; pMCPg checks what it needs." },
  { at: B3 + 0.1, text: "Connect <b>Claude Desktop, Claude Code, VS Code or LM Studio</b> in one click." },
];

// ---- Build DOM -----------------------------------------------------------------------------------

$("eyebrow").innerHTML = `${LOGO(36)} Install`;
const SW = 1000;
const SH = 720;
const persp = $("persp");
const plane = $("plane");
Object.assign(persp.style, { width: `${SW}px`, height: `${SH}px`, marginLeft: `${-SW / 2}px`, marginTop: `${-SH / 2}px` });

const term = el(
  "div",
  "win term",
  `${winBar("Terminal — zsh", "macOS · Linux")}
  <div class="body">
    <div class="cmd"><span class="p">$ </span><span id="cmd"></span><span class="cursor" id="cur"></span></div>
    ${OUT.map((o, i) => `<div class="out" id="out${i}">${o.html}</div>`).join("")}
  </div>`,
);
Object.assign(term.style, { left: "0px", top: "0px", width: "900px", height: "500px" });
plane.append(term);

const browser = el(
  "div",
  "win",
  `${winBar(`<span class="urlpill">${ICONS.lock.replace(/width="24" height="24"/, 'width="16" height="16"')} 127.0.0.1:7431</span>`, "pMCPg")}
  <div class="page" id="page1">
    <h2>Add a connection</h2>
    <div class="desc">pMCPg checks the address and tells you what it needs.</div>
    <div class="lbl">Paste a server URL</div>
    <div class="inrow"><div class="input" id="url"></div><span class="btn" id="check">Check</span></div>
    <div class="probe" id="probe">
      <span class="ic">${ICONS.key.replace(/width="24" height="24"/, 'width="26" height="26"')}</span>
      <div><b>Sign in with mcp.linear.app</b><div class="t">After adding it, you log in on the provider's page, like any app.</div><div class="u">${URL}</div></div>
    </div>
    <div class="addrow"><span class="btn" id="add">Add and sign in</span><div class="toast" id="toast"><span class="c">✓</span> Added Linear</div></div>
  </div>
  <div class="page" id="page2">
    <h2>Connect your AI app</h2>
    <div class="desc">Each app connects once, to pMCPg.</div>
    <div class="tiles">${APPS.map(
      (a, i) => `<div class="tile" id="tile${i}"><span class="lg" style="background:${a.bg}">${a.tile}</span><span><b>${a.name}</b><span class="s" id="ts${i}">${a.sub}</span></span></div>`,
    ).join("")}</div>
  </div>`,
);
Object.assign(browser.style, { left: "100px", top: "130px", width: "900px", height: "590px" });
plane.append(browser);

CAPTIONS.forEach((c, i) => {
  const cap = el("div", "cap", `<span>${c.text}</span>`);
  cap.id = `cap${i}`;
  $("caption").append(cap);
});

function fit() {
  const r = $("swrap").getBoundingClientRect();
  persp.style.scale = String(Math.min(r.width / SW, r.height / SH));
}
fit();

const endSegs = endCard($("end"), { line: "One binary for macOS, Windows and Linux.", small: "Also on npm, Homebrew and Docker" }, END);

// ---- Timeline ------------------------------------------------------------------------------------

const out = "easeOut";
const pop = [0.34, 1.4, 0.64, 1];

function build() {
  const caps = CAPTIONS.flatMap((c, i) => {
    const next = CAPTIONS[i + 1]?.at ?? END;
    return [
      [`#cap${i}`, { opacity: [0, 1], y: [24, 0] }, { at: c.at, duration: 0.4, ease: out }],
      [`#cap${i}`, { opacity: [1, 0], y: [0, -20] }, { at: next - 0.35, duration: 0.25, ease: "easeIn" }],
    ];
  });
  return animate([
    ["#eyebrow", { opacity: [0, 1], y: [16, 0] }, { at: 0.05, duration: 0.45, ease: out }],
    ["#h1", { opacity: [0, 1], y: [30, 0] }, { at: 0.2, duration: 0.55, ease: out }],
    [term, { opacity: [0, 1], y: [40, 0] }, { at: 0.6, duration: 0.5, ease: out }],
    [browser, { opacity: [0, 1], y: [160, 0] }, { at: B2, duration: 0.6, ease: out }],
    ["#check", { scale: [1, 0.92, 1] }, { at: 7.75, duration: 0.25 }],
    ["#add", { scale: [1, 0.92, 1] }, { at: 8.85, duration: 0.25 }],
    ["#toast", { opacity: [0, 1], y: [20, 0] }, { at: 9.0, duration: 0.35, ease: pop }],
    ["#page1", { opacity: [1, 0] }, { at: B3 - 0.1, duration: 0.3 }],
    ["#page2", { opacity: [0, 1], y: [20, 0] }, { at: B3 + 0.15, duration: 0.4, ease: out }],
    ...caps,
    ...endSegs,
    ["#endSmall", { opacity: [1, 1] }, { at: DURATION - 0.1, duration: 0.1 }],
  ]);
}

function onFrame(t) {
  // Tilt settles; the terminal steps back when the browser comes forward.
  const s = easeInOut(prog(t, 0.4, 2.4));
  const back = easeInOut(prog(t, B2, B2 + 0.7));
  const shrink = easeInOut(prog(t, B3, B3 + 0.5));
  plane.style.transform = `translateY(${110 * (1 - back) + 55 * shrink}px) rotateX(${16 - 9 * s}deg) rotateY(${-12 + 6 * s + 2 * back}deg)`;
  term.style.translate = `${-40 * back}px ${-50 * back}px ${-140 * back}px`;
  term.style.filter = `brightness(${1 - 0.45 * back})`;

  browser.style.height = `${590 - 110 * shrink}px`;

  // Terminal
  const typed = typeInto($("cmd"), CMD, t, 1.2, 55);
  $("cur").style.opacity = typed ? (Math.floor(t * 2.5) % 2 ? "0" : "1") : "1";
  OUT.forEach((o, i) => {
    $(`out${i}`).style.opacity = t >= o.at ? "1" : "0";
  });

  // Add a connection
  const u = $("url");
  if (t < 6.6) {
    u.textContent = "https://mcp.example.com/mcp";
    u.className = "input ph";
  } else {
    typeInto(u, URL, t, 6.6, 26);
    u.className = "input";
  }
  $("probe").style.opacity = String(fade(t, 8.0, 0.3));
  $("add").style.opacity = String(fade(t, 8.15, 0.3));

  // Connect tiles turn on one by one
  APPS.forEach((_, i) => {
    const on = t >= CONNECT_AT[i];
    $(`tile${i}`).className = `tile${on ? " on" : ""}`;
    const ts = $(`ts${i}`);
    ts.className = `s${on ? " on" : ""}`;
    ts.textContent = on ? "✓ Connected" : APPS[i].sub;
  });
}

for (const id of ["eyebrow", "h1", "toast", "page2"]) $(id).style.opacity = "0";
term.style.opacity = "0";
browser.style.opacity = "0";

// Played 1.35× slower than the times above: easier to read on a phone.
stage({ duration: DURATION, build, onFrame, slow: 1.35 });
