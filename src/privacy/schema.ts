// Privacy config schema. Owner: p2-privacy. Imported by src/core/config.ts (ProfileDef.privacyOptions).
// ProfileDef.privacy (off|standard|strict) stays the main switch; these fields fine-tune it.
import { z } from "zod";
import type { PiiType } from "./detector.ts";

export const PII_TYPES = [
  "EMAIL",
  "PHONE",
  "CARD",
  "IBAN",
  "IP",
  "NATIONAL_ID",
  "PERSON",
  "ORG",
  "ADDRESS",
  "SECRET",
] as const satisfies readonly PiiType[];

export const PrivacyOptions = z
  .object({
    /** Values never masked, e.g. the user's own email. Compared case-insensitively. */
    allow: z.array(z.string()).default([]),
    /** Accounts whose results are never masked. Secrets are still redacted. */
    skipAccounts: z.array(z.string()).default([]),
    /** Types never masked, e.g. ["IP"]. */
    skipTypes: z.array(z.enum(PII_TYPES)).default([]),
    /** Keys in structured results whose values are never masked, e.g. ["id", "url"]. */
    skipFields: z.array(z.string()).default([]),
    /**
     * Accounts that may receive personal data masked from other accounts' results, e.g. a calendar that
     * needs an email address read from mail. "*" means every account. Default: values only go back to
     * the account they came from.
     */
    shareAcrossAccounts: z.array(z.string()).default([]),
    /** Secrets found in tool arguments: stop the call, replace them, or let them through. */
    secretsInArguments: z.enum(["block", "redact", "off"]).default("block"),
    /** Secrets found in tool results: replace them, or let them through. Applies even when privacy is off. */
    secretsInResults: z.enum(["redact", "off"]).default("redact"),
  })
  .prefault({});
export type PrivacyOptions = z.infer<typeof PrivacyOptions>;
