import type { Metadata } from "next";
import { Inter, Oxanium } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme";
import "./globals.css";

const display = Oxanium({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  metadataBase: new URL("https://pmcpg.io"),
  title: { default: "pMCPg: Private MCP Gateway", template: "%s · pMCPg" },
  description:
    "Connect your AI app once. pMCPg runs your MCP connectors on your computer, keeps the keys in your keychain, and gives you rules, approvals and an activity log.",
  openGraph: { title: "pMCPg: Private MCP Gateway", url: "https://pmcpg.io", siteName: "pMCPg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
