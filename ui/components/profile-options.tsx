import { Badge } from "@/components/ui/badge";
import type { Preset, Privacy } from "@/lib/api";

/** Privacy masking is experimental in v0.1. */
export function BetaBadge() {
  return (
    <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground" title="Experimental in v0.1">
      Beta
    </Badge>
  );
}

export const MASKING_CAUTION =
  "Masking catches common patterns like emails and phone numbers. It can miss things, so don't rely on it alone for sensitive data.";

export const PRIVACY_OPTIONS: { value: Privacy; title: string; description: string }[] = [
  {
    value: "off",
    title: "Off",
    description: "Tool results reach the AI unchanged. Secrets such as API keys are still hidden.",
  },
  {
    value: "standard",
    title: "Standard",
    description: "Swaps emails, phone numbers and card numbers in tool results for placeholders.",
  },
  {
    value: "strict",
    title: "Strict",
    description: "Also hides labelled names, organisations and addresses. Expect some false alarms.",
  },
];

export const PRESET_OPTIONS: { value: Preset; title: string; description: string }[] = [
  { value: "open", title: "Open", description: "Every tool can run. For trusted, low-risk setups." },
  {
    value: "balanced",
    title: "Balanced",
    description: "Asks you before risky actions, like sending data out after reading untrusted content.",
  },
  { value: "careful", title: "Careful", description: "Asks you before anything that changes or sends data." },
];

export const privacyTitle = (p: Privacy) => PRIVACY_OPTIONS.find((o) => o.value === p)?.title ?? p;
export const presetTitle = (p: Preset) => PRESET_OPTIONS.find((o) => o.value === p)?.title ?? p;
