import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Link preview card (LinkedIn, Slack, X, iMessage). Rendered once at build time.
export const alt = "pMCPg: Private MCP Gateway";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default async function Image() {
  const icon = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const iconSrc = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse 55% 60% at 50% 45%, rgba(43,179,212,0.22), #0b0e12 75%)",
        backgroundColor: "#0b0e12",
        color: "#f4f6f8",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: ImageResponse needs a plain img */}
      <img src={iconSrc} width={220} height={220} alt="" />
      <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -3, marginTop: -10 }}>pMCPg</div>
      <div style={{ fontSize: 44, color: "#2bb3d4", marginTop: 4 }}>Private MCP Gateway</div>
    </div>,
    size,
  );
}
