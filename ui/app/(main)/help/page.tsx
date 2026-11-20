import { HelpIndex } from "@/components/help/help-index";
import { helpSummaries } from "@/lib/help";

export const metadata = { title: "Help · Private MCP Gateway" };

export default function HelpPage() {
  return <HelpIndex articles={helpSummaries()} />;
}
