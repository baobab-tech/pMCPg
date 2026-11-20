import type { PrivacyLevel } from "../../src/core/config.ts";
import { findSpans } from "../../src/privacy/mask.ts";

/** What masking finds in `text`, as "TYPE:value" strings in order. */
export async function found(
  text: string,
  level: PrivacyLevel = "standard",
  secrets = true,
): Promise<string[]> {
  const spans = await findSpans(text, { level, secrets });
  return spans.map((s) => `${s.type}:${text.slice(s.start, s.end)}`);
}
