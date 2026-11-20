"""Generate the README diagrams as animated SVGs (SMIL), in light and dark variants.

Run from the repo root:  python3 docs/assets/src/build_svgs.py
Writes docs/assets/<name>-light.svg and docs/assets/<name>-dark.svg.
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent

THEMES = {
    "light": dict(
        bg="#ffffff", border="#d0d7de", panel="#f6f8fa", gw="#eef5ff", gwstroke="#0969da",
        text="#1f2328", muted="#59636e", line="#afb8c1", accent="#0969da",
        green="#1a7f37", gtext="#1a7f37", pii="#bc4c00", red="#cf222e", hl="#ddf4ff", onpill="#ffffff",
    ),
    "dark": dict(
        bg="#0d1117", border="#30363d", panel="#161b22", gw="#0f1d33", gwstroke="#4493f8",
        text="#e6edf3", muted="#9198a1", line="#484f58", accent="#1f6feb",
        green="#238636", gtext="#3fb950", pii="#bd561d", red="#f85149", hl="#1c2d45", onpill="#ffffff",
    ),
}

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"


def head(w, h, c, title, desc):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{title}</title>
<desc id="desc">{desc}</desc>
<style>
  .t {{ font-family: {SANS}; fill: {c['text']}; }}
  .m {{ font-family: {MONO}; fill: {c['text']}; }}
  .mu {{ fill: {c['muted']}; }}
  .b {{ font-weight: 600; }}
  .w {{ fill: {c['onpill']}; }}
</style>
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="{c['line']}"/>
  </marker>
</defs>
<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="12" fill="{c['bg']}" stroke="{c['border']}"/>
"""


def _norm(frames, dur):
    """Pad keyframes so they cover 0..dur; return (values, keyTimes)."""
    frames = sorted(frames, key=lambda f: f[0])
    if frames[0][0] > 0:
        frames = [(0, frames[0][1])] + frames
    if frames[-1][0] < dur:
        frames = frames + [(dur, frames[-1][1])]
    vals = ";".join(str(v) for _, v in frames)
    keys = ";".join(f"{t / dur:.4f}" for t, _ in frames)
    return vals, keys


def anim(attr, frames, dur):
    vals, keys = _norm(frames, dur)
    return f'<animate attributeName="{attr}" values="{vals}" keyTimes="{keys}" dur="{dur}s" repeatCount="indefinite"/>'


def move(frames, dur):
    """frames: (t, (x, y)) -> translate animation."""
    vals, keys = _norm([(t, f"{x} {y}") for t, (x, y) in frames], dur)
    return f'<animateTransform attributeName="transform" type="translate" values="{vals}" keyTimes="{keys}" dur="{dur}s" repeatCount="indefinite"/>'


def show(t_in, t_out, fade=0.25):
    """Opacity keyframes: hidden, fade in at t_in, fade out ending at t_out."""
    return [(max(t_in - fade, 0), 0), (t_in, 1), (t_out - fade, 1), (t_out, 0)]


def pill_w(text):
    return int(len(text) * 7.3 + 22)


def pill(text, color, c, frames, opacity, dur):
    w = pill_w(text)
    return f"""<g opacity="0">
  {move(frames, dur)}
  {anim('opacity', opacity, dur)}
  <rect x="{-w/2}" y="-12" width="{w}" height="24" rx="12" fill="{color}"/>
  <text class="m w" x="0" y="4" font-size="12" text-anchor="middle">{text}</text>
</g>
"""


def flash_rect(x, y, w, h, c, windows, dur, rx=8):
    """A highlight rectangle shown during the given (t_in, t_out) windows."""
    frames = []
    for a, b in windows:
        frames += [(a - 0.15, 0), (a, 1), (b, 1), (b + 0.15, 0)]
    frames = [(0, 0)] + frames
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{c["hl"]}" stroke="{c["accent"]}" stroke-width="1.5" opacity="0">{anim("opacity", frames, dur)}</rect>\n'


# --------------------------------------------------------------------------
# 1. Before / after
# --------------------------------------------------------------------------

def before_after(c):
    W, H, D = 1000, 444, 3
    s = head(W, H, c, "Before and after Private MCP Gateway",
             "Left: three AI apps each connect to five MCP servers, fifteen connections with keys copied into each app, "
             "and your MCP setup depends on Claude. "
             "Right: each app connects once to Private MCP Gateway, which connects to the five servers and keeps the keys in the OS keychain.")
    clients = ["Claude app", "Coding agent", "Local AI app"]
    servers = ["Email", "Calendar", "Files", "CRM", "Web search"]
    cy = [130, 205, 280]
    sy = [100, 150, 200, 250, 300]

    # Panel titles and divider
    s += f'<line x1="500" y1="24" x2="500" y2="420" stroke="{c["border"]}"/>\n'
    s += '<text class="t b" x="40" y="48" font-size="16">Without a gateway</text>\n'
    s += '<text class="t b" x="532" y="48" font-size="16">With Private MCP Gateway</text>\n'

    def box(x, y, w, h, label, fill, mono=False, size=13):
        cls = "m" if mono else "t"
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{c["border"]}"/>'
                f'<text class="{cls}" x="{x + w/2}" y="{y + h/2 + 4.5}" font-size="{size}" text-anchor="middle">{label}</text>\n')

    def dotpath(pid, d, color, begin, dur):
        return (f'<path id="{pid}" d="{d}" fill="none" stroke="{c["line"]}" stroke-width="1.3"/>\n'
                f'<circle r="3.5" fill="{color}"><animateMotion dur="{dur}s" begin="{begin}s" repeatCount="indefinite"><mpath href="#{pid}"/></animateMotion></circle>\n')

    # Left: everything to everything
    for i, y in enumerate(cy):
        for j, y2 in enumerate(sy):
            s += dotpath(f"l{i}{j}", f"M150,{y} L350,{y2}", c["pii"], -(((i * 5 + j) * 0.37) % D), D)
    for i, y in enumerate(cy):
        s += box(40, y - 18, 110, 36, clients[i], c["panel"])
    for j, y in enumerate(sy):
        s += box(350, y - 16, 120, 32, servers[j], c["panel"])

    # Right: one gateway
    gx1, gx2 = 690, 790
    for i, y in enumerate(cy):
        s += dotpath(f"r{i}", f"M642,{y} L{gx1},205", c["accent"], -i * 0.9, D)
    for j, y in enumerate(sy):
        s += dotpath(f"s{j}", f"M{gx2},205 L856,{y}", c["accent"], -j * 0.55, D)
    for i, y in enumerate(cy):
        s += box(532, y - 18, 110, 36, clients[i], c["panel"])
    for j, y in enumerate(sy):
        s += box(856, y - 16, 120, 32, servers[j], c["panel"])
    s += f'<rect x="{gx1}" y="92" width="{gx2-gx1}" height="226" rx="12" fill="{c["gw"]}" stroke="{c["gwstroke"]}" stroke-width="2"/>\n'
    # lock icon
    lx, ly = 740, 150
    s += (f'<path d="M{lx-9},{ly} v-7 a9,9 0 0 1 18,0 v7" fill="none" stroke="{c["gwstroke"]}" stroke-width="2.5"/>'
          f'<rect x="{lx-13}" y="{ly}" width="26" height="20" rx="4" fill="{c["gwstroke"]}"/>\n')
    for k, word in enumerate(["Private", "MCP", "Gateway"]):
        s += f'<text class="t b" x="740" y="{205 + k*18}" font-size="13" text-anchor="middle">{word}</text>\n'

    # Captions
    left = ["15 connections to set up and keep in sync", "Keys copied into each app's config file",
            "Every tool loaded into the AI's context", "Dependency on Claude for managing your MCPs"]
    right = ["One connection per app", "Keys kept in your OS keychain",
             "Two tools in context: search_tools, call_tool"]
    for k, a in enumerate(left):
        s += f'<text class="t" x="40" y="{350 + k * 22}" font-size="13"><tspan fill="{c["red"]}">✕</tspan>  {a}</text>\n'
    for k, b in enumerate(right):
        s += f'<text class="t" x="532" y="{350 + k * 22}" font-size="13"><tspan fill="{c["gtext"]}">✓</tspan>  {b}</text>\n'
    return s + "</svg>\n"


# --------------------------------------------------------------------------
# 2. Request flow
# --------------------------------------------------------------------------

def request_flow(c):
    W, H, D = 1000, 420, 16
    s = head(W, H, c, "How a request flows through Private MCP Gateway",
             "Animation in four steps. 1: the AI searches for a tool. 2: the AI calls the tool; the gateway checks policy and adds "
             "the saved sign-in. 3: the result contains jane@acme.org; the gateway masks it as [EMAIL_1] before the AI sees it. "
             "4: when the AI replies to [EMAIL_1], the gateway puts jane@acme.org back before sending the call to the server.")

    TOP, BOT = 182, 262  # track y positions
    # Client and server
    s += f'<rect x="24" y="112" width="136" height="200" rx="10" fill="{c["panel"]}" stroke="{c["border"]}"/>\n'
    s += '<text class="t b" x="92" y="226" font-size="15" text-anchor="middle">AI client</text>\n'
    s += '<text class="t mu" x="92" y="246" font-size="12" text-anchor="middle">Claude app,</text>\n'
    s += '<text class="t mu" x="92" y="262" font-size="12" text-anchor="middle">coding agent</text>\n'
    s += f'<rect x="840" y="112" width="136" height="200" rx="10" fill="{c["panel"]}" stroke="{c["border"]}"/>\n'
    s += flash_rect(840, 112, 136, 200, c, [(6.6, 7.4), (14.2, 14.9)], D, rx=10)
    s += '<text class="t b" x="908" y="226" font-size="15" text-anchor="middle">MCP server</text>\n'
    s += '<text class="t mu" x="908" y="246" font-size="12" text-anchor="middle">e.g. your email</text>\n'

    # Gateway frame
    s += f'<rect x="192" y="60" width="616" height="300" rx="12" fill="{c["gw"]}" stroke="{c["gwstroke"]}" stroke-width="2"/>\n'
    s += f'<text class="t b" x="210" y="86" font-size="13" fill="{c["gwstroke"]}" style="fill:{c["gwstroke"]}">Private MCP Gateway · on your machine</text>\n'

    # Tracks
    s += f'<line x1="160" y1="{TOP}" x2="838" y2="{TOP}" stroke="{c["line"]}" stroke-width="2" marker-end="url(#arr)"/>\n'
    s += f'<line x1="840" y1="{BOT}" x2="162" y2="{BOT}" stroke="{c["line"]}" stroke-width="2" marker-end="url(#arr)"/>\n'
    s += f'<text class="t mu" x="796" y="{TOP-18}" font-size="11" text-anchor="end">request</text>\n'
    s += f'<text class="t mu" x="796" y="{BOT+26}" font-size="11" text-anchor="end">result</text>\n'

    def node(cx, y, label, windows, mono=False):
        w, h = 124, 34
        out = f'<rect x="{cx-w/2}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["bg"]}" stroke="{c["border"]}"/>\n'
        out += flash_rect(cx - w/2, y, w, h, c, windows, D)
        cls = "m" if mono else "t"
        out += f'<text class="{cls}" x="{cx}" y="{y + 21.5}" font-size="13" text-anchor="middle">{label}</text>\n'
        return out

    top_y, bot_y = 108, 296
    s += node(280, top_y, "search_tools", [(1.4, 2.6)], mono=True)
    s += node(420, top_y, "call_tool", [(3.75, 4.1), (11.75, 12.0)], mono=True)
    s += node(560, top_y, "Policy check", [(4.6, 5.0), (12.25, 12.5)])
    s += node(700, top_y, "Unmask + keys", [(5.6, 6.0), (12.8, 13.5)])
    s += node(620, bot_y, "Scan + mask", [(8.3, 9.1)])
    s += node(400, bot_y, "Activity log", [(9.55, 9.9)])

    # Badges: policy tick and key
    s += f'<g opacity="0">{anim("opacity", show(4.8, 15.8), D)}<circle cx="618" cy="108" r="10" fill="{c["green"]}"/><text class="t w b" x="618" y="112.5" font-size="13" text-anchor="middle">✓</text></g>\n'
    s += (f'<g opacity="0">{anim("opacity", show(5.8, 15.8), D)}<circle cx="758" cy="108" r="10" fill="{c["green"]}"/>'
          f'<circle cx="754" cy="108" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/>'
          f'<path d="M757,108 h6 M761,108 v3" stroke="#fff" stroke-width="1.6" fill="none"/></g>\n')

    # Search result note
    s += f'<g opacity="0">{anim("opacity", show(1.8, 3.0), D)}<text class="m" x="280" y="{TOP+30}" font-size="11.5" text-anchor="middle" style="fill:{c["accent"]}">→ gmail__search</text></g>\n'

    # Pills
    A, G, P = c["accent"], c["green"], c["pii"]
    s += pill("search: email", A, c, [(0.2, (165, TOP)), (1.4, (280, TOP))], show(0.4, 2.9), D)
    s += pill("call gmail__search", A, c,
              [(3.0, (165, TOP)), (3.8, (420, TOP)), (4.6, (560, TOP)), (5.0, (560, TOP)),
               (5.6, (700, TOP)), (6.0, (700, TOP)), (6.6, (840, TOP))], show(3.2, 6.9), D)
    s += pill("jane@acme.org", P, c, [(7.3, (840, BOT)), (8.3, (620, BOT))], show(7.5, 9.0, 0.15), D)
    s += pill("[EMAIL_1]", G, c, [(8.9, (620, BOT)), (9.1, (620, BOT)), (9.7, (400, BOT)), (10.5, (165, BOT))],
              show(9.0, 11.2, 0.15), D)
    s += pill("to: [EMAIL_1]", G, c, [(11.4, (165, TOP)), (12.8, (700, TOP))], show(11.6, 13.4, 0.15), D)
    s += pill("to: jane@acme.org", P, c, [(13.3, (700, TOP)), (13.5, (700, TOP)), (14.2, (840, TOP))],
              show(13.4, 14.9, 0.15), D)

    # "Model sees" note at client
    s += (f'<g opacity="0">{anim("opacity", show(10.6, 15.8), D)}'
          f'<text class="t" x="92" y="296" font-size="11.5" text-anchor="middle" style="fill:{c["gtext"]}">sees [EMAIL_1] only</text></g>\n')

    # Captions
    caps = [
        (0.0, 3.0, "Step 1 · The AI searches. The gateway returns only the tools that match."),
        (3.0, 7.1, "Step 2 · The AI calls a tool. The gateway checks your rules and adds your saved sign-in."),
        (7.1, 11.3, "Step 3 · The result comes back. For a cloud model, personal data is masked first."),
        (11.3, 16.0, "Step 4 · When the AI uses [EMAIL_1], the gateway puts the real address back."),
    ]
    for a, b, text in caps:
        frames = [(a, 0), (a + 0.25, 1), (b - 0.25, 1), (b, 0)] if a > 0 else [(0, 1), (b - 0.25, 1), (b, 0), (D - 0.25, 0), (D, 1)]
        s += f'<text class="t" x="500" y="396" font-size="15" text-anchor="middle" opacity="{1 if a == 0 else 0}">{anim("opacity", frames, D)}{text}</text>\n'
    return s + "</svg>\n"


# --------------------------------------------------------------------------
# 3. Profiles
# --------------------------------------------------------------------------

def profiles(c):
    W, H, D = 1000, 420, 3
    s = head(W, H, c, "Profiles in Private MCP Gateway",
             "The Briefing agent connects to the Briefing profile URL and sees work email, work chat, shared drive and notes. "
             "The Research agent connects to the Research profile URL and sees notes, web search and papers. "
             "The Research agent cannot reach work email.")
    B, R = c["accent"], c["green"]

    def box(x, y, w, h, fill, stroke=None, sw=1):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke or c["border"]}" stroke-width="{sw}"/>'

    def flow(pid, d, color, begin, dashed=False):
        dash = ' stroke-dasharray="5 5"' if dashed else ""
        return (f'<path id="{pid}" d="{d}" fill="none" stroke="{color}" stroke-opacity="0.55" stroke-width="2"{dash}/>\n'
                f'<circle r="4" fill="{color}"><animateMotion dur="{D}s" begin="{begin}s" repeatCount="indefinite"><mpath href="#{pid}"/></animateMotion></circle>\n')

    # Gateway frame
    s += f'<rect x="216" y="40" width="620" height="336" rx="12" fill="{c["gw"]}" stroke="{c["gwstroke"]}" stroke-width="2"/>\n'
    s += f'<text class="t b" x="234" y="66" font-size="13" style="fill:{c["gwstroke"]}">Private MCP Gateway</text>\n'
    s += '<text class="t mu" x="296" y="92" font-size="12">Profiles (one URL each)</text>\n'
    s += '<text class="t mu" x="660" y="66" font-size="12">Accounts (signed in once)</text>\n'

    accts = [("Work email", 100, "b"), ("Work chat", 148, "b"), ("Shared drive", 196, "b"),
             ("Notes", 244, "both"), ("Web search", 292, "r"), ("Papers", 340, "r")]
    by, ry = 130, 290  # profile centres
    px2 = 470  # profile chip right edge

    # Agent -> profile
    s += flow("ab", f"M184,{by} L280,{by}", B, 0)
    s += flow("ar", f"M184,{ry} L280,{ry}", R, -1.4)
    # Profile -> accounts
    for k, (name, y, who) in enumerate(accts):
        if who in ("b", "both"):
            s += flow(f"pb{k}", f"M{px2},{by} C560,{by} 580,{y} 660,{y}", B, -k * 0.6)
        if who in ("r", "both"):
            s += flow(f"pr{k}", f"M{px2},{ry} C560,{ry} 580,{y} 660,{y}", R, -k * 0.7)

    # Blocked attempt: research -> work email
    s += (f'<path d="M{px2},{ry - 10} C520,200 560,120 640,104" fill="none" stroke="{c["red"]}" stroke-width="2" stroke-dasharray="4 5">'
          f'{anim("opacity", [(0, 0.25), (1.2, 0.9), (2.4, 0.25)], D)}</path>\n')
    s += (f'<g>{anim("opacity", [(0, 0.5), (1.2, 1), (2.4, 0.5)], D)}<circle cx="530" cy="198" r="11" fill="{c["red"]}"/>'
          f'<text class="t w b" x="530" y="203" font-size="14" text-anchor="middle">✕</text></g>\n')

    # Agents
    for y, name, color in [(by, "Briefing agent", B), (ry, "Research agent", R)]:
        s += box(24, y - 26, 160, 52, c["panel"], color, 2)
        s += f'<text class="t b" x="104" y="{y + 5}" font-size="14" text-anchor="middle">{name}</text>\n'

    # Profile chips
    for y, name, url, color in [(by, "Briefing", "/p/briefing/mcp", B), (ry, "Research", "/p/research/mcp", R)]:
        s += box(280, y - 28, px2 - 280, 56, c["bg"], color, 2)
        s += f'<text class="t b" x="296" y="{y - 5}" font-size="14">{name}</text>\n'
        s += f'<text class="m mu" x="296" y="{y + 15}" font-size="12">{url}</text>\n'

    # Accounts
    for name, y, who in accts:
        stroke = {"b": B, "r": R, "both": c["muted"]}[who]
        s += box(660, y - 17, 156, 34, c["bg"], stroke, 1.5)
        s += f'<text class="t" x="738" y="{y + 4.5}" font-size="13" text-anchor="middle">{name}</text>\n'
    s += '<text class="t mu" x="850" y="248.5" font-size="11.5">← in both profiles</text>\n'
    s += f'<text class="t" x="850" y="104.5" font-size="11.5" style="fill:{c["red"]}">← not visible</text>\n'
    s += f'<text class="t" x="850" y="120.5" font-size="11.5" style="fill:{c["red"]}">to Research</text>\n'

    s += ('<text class="t" x="500" y="402" font-size="14" text-anchor="middle">'
          'Each agent connects to its own profile URL and sees only that profile\'s tools. The AI cannot switch profiles.</text>\n')
    return s + "</svg>\n"


# --------------------------------------------------------------------------
# 5. Where data goes: your machine vs the cloud
# --------------------------------------------------------------------------

def where_data_goes(c):
    W, H, D = 1000, 478, 4
    s = head(W, H, c, "Where your data goes",
             "Your machine holds the Claude app, a coding agent, a local AI app with a local model, Private MCP Gateway and local MCP servers. "
             "The cloud holds the cloud AI model and remote MCP servers. The Claude app and coding agent send prompts and tool results to the cloud model, "
             "so personal data is masked as [EMAIL_1] first. The local AI app talks to the local model on the machine. "
             "The gateway reaches local servers over stdio and remote servers over HTTPS with OAuth.")

    def box(x, y, w, h, label, stroke=None, sw=1, sub=None, bold=False):
        out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["bg"]}" stroke="{stroke or c["border"]}" stroke-width="{sw}"/>'
        b = " b" if bold else ""
        if sub:
            out += f'<text class="t{b}" x="{x + w/2}" y="{y + h/2 - 3}" font-size="13" text-anchor="middle">{label}</text>'
            out += f'<text class="t mu" x="{x + w/2}" y="{y + h/2 + 14}" font-size="11.5" text-anchor="middle">{sub}</text>'
        else:
            out += f'<text class="t{b}" x="{x + w/2}" y="{y + h/2 + 4.5}" font-size="13" text-anchor="middle">{label}</text>'
        return out + "\n"

    def flow(pid, d, color, begin, dur=D, width=1.6):
        return (f'<path id="{pid}" d="{d}" fill="none" stroke="{c["line"]}" stroke-width="{width}"/>\n'
                f'<circle r="3.5" fill="{color}"><animateMotion dur="{dur}s" begin="{begin}s" repeatCount="indefinite"><mpath href="#{pid}"/></animateMotion></circle>\n')

    s += '<g transform="translate(0,-32)">\n'
    # Containers
    s += f'<rect x="16" y="52" width="612" height="392" rx="14" fill="{c["panel"]}" stroke="{c["border"]}" stroke-width="1.5"/>\n'
    s += '<text class="t b" x="36" y="80" font-size="15">Your machine</text>\n'
    s += f'<rect x="646" y="52" width="338" height="392" rx="14" fill="{c["panel"]}" stroke="{c["muted"]}" stroke-width="1.5" stroke-dasharray="6 5"/>\n'
    s += '<text class="t b" x="666" y="80" font-size="15">Cloud</text>\n'

    # Cloud lanes: apps -> cloud model
    s += f'<text class="t mu" x="420" y="112" font-size="11.5" text-anchor="middle">prompts and tool results go to the model provider</text>\n'
    s += f'<path d="M180,124 L680,124" fill="none" stroke="{c["line"]}" stroke-width="2"/>\n'
    s += f'<path d="M180,196 C214,196 214,140 248,140 L680,140" fill="none" stroke="{c["line"]}" stroke-width="2"/>\n'
    G = c["green"]
    for k, y in enumerate((124, 140)):
        s += pill("[EMAIL_1]", G, c, [(0.2 + k * 2, (240, y)), (1.8 + k * 2, (600, y))],
                  [(0.0 + k * 2, 0), (0.25 + k * 2, 1), (1.6 + k * 2, 1), (1.85 + k * 2, 0)], D)

    # Apps -> gateway
    A = c["accent"]
    s += flow("ag1", "M180,140 L250,215", A, 0)
    s += flow("ag2", "M180,206 L250,242", A, -1.3)
    s += flow("ag3", "M180,300 L250,272", A, -2.6)
    # Local AI app <-> local model
    s += flow("lm", f"M110,322 L110,372", G, 0, 2)
    s += flow("lm2", f"M110,372 L110,322", G, -1, 2)
    s += f'<text class="t" x="122" y="352" font-size="11.5" style="fill:{c["gtext"]}">local only</text>\n'

    # Gateway -> local servers
    for k, y in enumerate((205, 255, 305)):
        s += flow(f"ls{k}", f"M350,250 L430,{y}", A, -k * 0.8)
    s += '<text class="t mu" x="430" y="182" font-size="12">Local MCP servers (stdio)</text>\n'

    # Gateway -> remote servers
    for k, y in enumerate((260, 310, 360)):
        s += flow(f"rs{k}", f"M300,350 L300,420 L660,420 C690,420 676,{y} 700,{y}", A, -k * 1.1)
    s += '<text class="t mu" x="470" y="412" font-size="11.5" text-anchor="middle">HTTPS + OAuth, keys from your keychain</text>\n'

    # Boxes on top of lines
    s += box(40, 106, 140, 40, "Claude app")
    s += box(40, 180, 140, 40, "Coding agent")
    s += box(40, 280, 140, 40, "Local AI app")
    s += box(40, 372, 140, 40, "Local model", G, 1.5)
    s += box(430, 188, 170, 34, "Files")
    s += box(430, 238, 170, 34, "Notes")
    s += box(430, 288, 170, 34, "Local database")
    s += box(680, 98, 270, 64, "Cloud AI model", c["pii"], 1.5, sub="Claude, GPT, Gemini and others", bold=True)
    s += f'<text class="t" x="815" y="182" font-size="11.5" text-anchor="middle" style="fill:{c["gtext"]}">sees [EMAIL_1], never jane@acme.org</text>\n'
    s += '<text class="t mu" x="700" y="234" font-size="12">Remote MCP servers</text>\n'
    s += box(700, 243, 230, 34, "Email")
    s += box(700, 293, 230, 34, "CRM")
    s += box(700, 343, 230, 34, "Web search")

    # Gateway
    s += f'<rect x="250" y="150" width="100" height="200" rx="12" fill="{c["gw"]}" stroke="{c["gwstroke"]}" stroke-width="2"/>\n'
    lx, ly = 300, 196
    s += (f'<path d="M{lx-9},{ly} v-7 a9,9 0 0 1 18,0 v7" fill="none" stroke="{c["gwstroke"]}" stroke-width="2.5"/>'
          f'<rect x="{lx-13}" y="{ly}" width="26" height="20" rx="4" fill="{c["gwstroke"]}"/>\n')
    for k, word in enumerate(["Private", "MCP", "Gateway"]):
        s += f'<text class="t b" x="300" y="{252 + k*18}" font-size="13" text-anchor="middle">{word}</text>\n'

    # Legend
    s += (f'<text class="t" x="36" y="474" font-size="13"><tspan fill="{c["pii"]}">●</tspan>  '
          'Cloud AI model: tool results travel to the provider inside the prompt. Turn masking on.</text>\n')
    s += (f'<text class="t" x="36" y="496" font-size="13"><tspan fill="{c["gtext"]}">●</tspan>  '
          'Local model and local MCP servers: nothing leaves your machine. Masking is optional.</text>\n')
    return s + "</g>\n</svg>\n"


# --------------------------------------------------------------------------
# 6. Connectors swipe: Claude with many connectors -> one gateway connection
# --------------------------------------------------------------------------

def connectors_swipe(c):
    W, H, D = 1000, 300, 10
    T0, T1, TR = 3.4, 5.6, 9.2  # wipe start, wipe end, reset
    s = head(W, H, c, "Many connectors replaced by one gateway",
             "Before: the Claude app holds seven connectors, each a URL or command with its own key, several showing expired sign-ins. "
             "A wipe sweeps across: Private MCP Gateway slots in next to Claude as its only connector, the servers move behind it, and every status turns green.")
    rows = [
        ("crm.example.org/mcp", "token expired", False),
        ("mail.example.com/mcp", "", True),
        ("npx files-mcp ~/Documents", "key in config file", False),
        ("drive.example.com/mcp", "", True),
        ("search.example.com/mcp", "API key in config", False),
        ("chat.example.com/mcp", "sign in again", False),
        ("npx notes-mcp", "", True),
    ]
    ys = [56 + i * 34 for i in range(len(rows))]
    CY = 158
    G, R = c["green"], c["red"]
    cb = anim("x", [(T0, 160), (T1, 990), (TR + 0.4, 990), (TR + 0.41, 160)], D)
    ca = anim("width", [(T0, 160), (T1, 990), (D - 0.01, 990), (D, 160)], D)
    s += (f'<defs><clipPath id="cb"><rect x="160" y="0" width="1000" height="{H}">{cb}</rect></clipPath>'
          f'<clipPath id="ca"><rect x="0" y="0" width="160" height="{H}">{ca}</rect></clipPath></defs>\n')

    # Titles
    s += (f'<text class="t b" x="36" y="34" font-size="15">'
          f'{anim("opacity", [(0, 1), (T0, 1), (T0 + 0.4, 0), (TR + 0.45, 0), (TR + 0.75, 1)], D)}'
          'Without a gateway: one connector per server, keys in each app</text>\n')
    s += (f'<text class="t b" x="36" y="34" font-size="15" opacity="0">'
          f'{anim("opacity", [(T1 - 0.4, 0), (T1, 1), (TR, 1), (TR + 0.3, 0)], D)}'
          'With Private MCP Gateway: one connector, every server healthy</text>\n')

    def srv_pill(x, y, name, ok, blink_i=0):
        out = f'<rect x="{x}" y="{y - 13}" width="270" height="26" rx="13" fill="{c["bg"]}" stroke="{c["border"]}"/>'
        dot = G if ok else R
        blink = "" if ok else f'<animate attributeName="opacity" values="1;0.25;1" dur="1.2s" begin="{blink_i * 0.3}s" repeatCount="indefinite"/>'
        out += f'<circle cx="{x + 15}" cy="{y}" r="5" fill="{dot}">{blink}</circle>'
        out += f'<text class="m" x="{x + 28}" y="{y + 4}" font-size="12">{name}</text>'
        return out + "\n"

    # BEFORE layer: Claude -> each server directly
    s += f'<g clip-path="url(#cb)"><g>{anim("opacity", [(T1, 1), (T1 + 0.01, 0), (TR + 0.45, 0), (TR + 0.75, 1)], D)}\n'
    TP = T0 + (T1 - T0) * (330 - 160) / (990 - 160)  # bar reaches the pills
    s += f'<g>{move([(0, (0, 0)), (TP, (0, 0)), (T1, (660, 0)), (TR + 0.4, (660, 0)), (TR + 0.41, (0, 0))], D)}\n'
    for i, ((name, status, ok), y) in enumerate(zip(rows, ys)):
        s += f'<path d="M160,{CY} C240,{CY} 250,{y} 330,{y}" fill="none" stroke="{c["line"]}" stroke-width="1.5"/>\n'
        s += srv_pill(330, y, name, ok, i)
        if status:
            s += f'<text class="t" x="612" y="{y + 4}" font-size="12" style="fill:{R}">{status}</text>\n'
    s += '</g>\n</g></g>\n'

    # AFTER layer: Claude -> gateway -> servers
    s += f'<g clip-path="url(#ca)"><g>{anim("opacity", [(TR, 1), (TR + 0.35, 0), (D - 0.01, 0), (D, 1)], D)}\n'
    s += f'<path d="M160,{CY} L250,{CY}" fill="none" stroke="{c["accent"]}" stroke-width="3"/>\n'
    for i, y in enumerate(ys):
        pid = f"sw{i}"
        s += (f'<path id="{pid}" d="M390,{CY} C500,{CY} 520,{y} 620,{y}" fill="none" stroke="{c["line"]}" stroke-width="1.5"/>'
              f'<circle r="3.5" fill="{c["accent"]}"><animateMotion dur="2.4s" begin="{-i * 0.34}s" repeatCount="indefinite"><mpath href="#{pid}"/></animateMotion></circle>\n')
    for (name, _, _), y in zip(rows, ys):
        s += srv_pill(620, y, name, True)
    s += f'<rect x="250" y="{CY - 62}" width="140" height="124" rx="12" fill="{c["gw"]}" stroke="{c["gwstroke"]}" stroke-width="2"/>\n'
    lx, ly = 320, CY - 30
    s += (f'<path d="M{lx-8},{ly} v-6 a8,8 0 0 1 16,0 v6" fill="none" stroke="{c["gwstroke"]}" stroke-width="2.5"/>'
          f'<rect x="{lx-12}" y="{ly}" width="24" height="18" rx="4" fill="{c["gwstroke"]}"/>\n')
    s += f'<text class="t b" x="320" y="{CY + 16}" font-size="13" text-anchor="middle">Private MCP</text>\n'
    s += f'<text class="t b" x="320" y="{CY + 33}" font-size="13" text-anchor="middle">Gateway</text>\n'
    s += f'<text class="t" x="320" y="{CY + 84}" font-size="11.5" text-anchor="middle" style="fill:{c["gtext"]}">keys in your keychain</text>\n'
    s += f'<text class="t" x="320" y="{CY + 100}" font-size="11.5" text-anchor="middle" style="fill:{c["gtext"]}">sign-ins refreshed</text>\n'
    s += '</g></g>\n'

    # Wipe bar
    s += (f'<g opacity="0">{anim("opacity", [(T0 - 0.01, 0), (T0, 1), (T1, 1), (T1 + 0.2, 0)], D)}'
          f'<rect x="158" y="48" width="4" height="230" rx="2" fill="{c["accent"]}">{anim("x", [(T0, 158), (T1, 988)], D)}</rect></g>\n')

    # Claude badge (static, on top)
    s += f'<rect x="36" y="{CY - 30}" width="124" height="60" rx="12" fill="{c["panel"]}" stroke="{c["border"]}" stroke-width="1.5"/>\n'
    s += f'<text class="t b" x="98" y="{CY - 2}" font-size="15" text-anchor="middle">Claude</text>\n'
    s += f'<text class="t mu" x="98" y="{CY + 16}" font-size="11.5" text-anchor="middle">or any AI app</text>\n'
    return s + "</svg>\n"


# --------------------------------------------------------------------------
# 4. Logo (one file, reads on light and dark backgrounds)
# --------------------------------------------------------------------------

def logo():
    blue = "#1f6feb"
    s = ('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Private MCP Gateway logo">\n'
         '<title>Private MCP Gateway</title>\n')
    # three inputs on the left, five outputs on the right
    for y in (56, 80, 104):
        s += f'<path d="M6,{y} C24,{y} 30,80 50,80" fill="none" stroke="{blue}" stroke-width="5" stroke-linecap="round"/>\n'
    for y in (34, 57, 80, 103, 126):
        s += f'<path d="M110,80 C130,80 136,{y} 154,{y}" fill="none" stroke="{blue}" stroke-width="5" stroke-linecap="round"/>\n'
    s += f'<rect x="44" y="44" width="72" height="72" rx="18" fill="{blue}"/>\n'
    s += '<path d="M68,78 v-9 a12,12 0 0 1 24,0 v9" fill="none" stroke="#fff" stroke-width="6"/>\n'
    s += '<rect x="62" y="77" width="36" height="26" rx="5" fill="#fff"/>\n'
    s += f'<circle cx="80" cy="88" r="4" fill="{blue}"/><rect x="78" y="88" width="4" height="8" rx="1" fill="{blue}"/>\n'
    return s + "</svg>\n"


if __name__ == "__main__":
    for name, fn in [("before-after", before_after), ("where-data-goes", where_data_goes), ("connectors-swipe", connectors_swipe), ("request-flow", request_flow), ("profiles", profiles)]:
        for theme, colors in THEMES.items():
            path = OUT / f"{name}-{theme}.svg"
            path.write_text(fn(colors))
            print("wrote", path.relative_to(OUT.parent.parent))
    (OUT / "logo.svg").write_text(logo())
    print("wrote docs/assets/logo.svg")
