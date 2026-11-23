import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Link preview card, rendered at build time by app/opengraph-image.tsx and app/twitter-image.tsx. Both use dark; light is kept for other uses.
export const ogAlt = "pMCPg: Private MCP Gateway. Your MCP connectors on your computer, keys in your keychain.";
export const ogSize = { width: 1200, height: 630 };

const themes = {
  light: {
    bg: "#fbfcfd",
    glow: "rgba(43,179,212,0.22)",
    text: "#111418",
    brand: "#0f7a99",
    chipText: "#0b4f63",
    chipBg: "rgba(15,122,153,0.08)",
    muted: "#5b6670",
  },
  dark: {
    bg: "#0b0e12",
    glow: "rgba(43,179,212,0.28)",
    text: "#f4f6f8",
    brand: "#2bb3d4",
    chipText: "#d7f3fa",
    chipBg: "rgba(43,179,212,0.12)",
    muted: "#9aa4ae",
  },
};

const chips = ["Keys in your keychain", "Rules & approvals", "Personal data masking", "Activity log"];

export async function ogCard(theme: keyof typeof themes) {
  const t = themes[theme];
  const icon = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const iconSrc = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: `radial-gradient(ellipse 60% 70% at 85% 20%, ${t.glow}, ${t.bg} 70%)`,
        backgroundColor: t.bg,
        color: t.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {/* biome-ignore lint/performance/noImgElement: ImageResponse needs a plain img */}
        <img src={iconSrc} width={132} height={132} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>pMCPg</div>
          <div style={{ fontSize: 38, color: t.brand, marginTop: 10 }}>Private MCP Gateway</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <div style={{ fontSize: 46, lineHeight: 1.25, maxWidth: 1000 }}>
          Connect your AI app once. Your connectors run on your computer.
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {chips.map((c) => (
            <div
              key={c}
              style={{
                display: "flex",
                flexShrink: 0,
                whiteSpace: "nowrap",
                fontSize: 23,
                padding: "10px 18px",
                borderRadius: 999,
                border: `2px solid ${t.brand}`,
                color: t.chipText,
                backgroundColor: t.chipBg,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: t.muted }}>
        <div>pmcpg.io</div>
        <div>Open source · No account · No cloud</div>
      </div>
    </div>,
    ogSize,
  );
}
