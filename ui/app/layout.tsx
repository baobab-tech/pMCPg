import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ViewProvider } from "@/components/view";
import { Oxanium } from "next/font/google";
import { cn } from "@/lib/utils";

const oxanium = Oxanium({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Private MCP Gateway",
  description: "pMCPg: your private gateway between AI apps and the tools they use",
  referrer: "same-origin",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", oxanium.variable)} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider>
          <ViewProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </ViewProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
