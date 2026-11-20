// PII detector contract (docs/design.md "Privacy layer"). Owner: privacy (Phase 2).
import type { PrivacyLevel } from "../core/config.ts";

export type PiiType =
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "IBAN"
  | "IP"
  | "NATIONAL_ID"
  | "PERSON"
  | "ORG"
  | "ADDRESS"
  | "SECRET";

export interface Span {
  start: number;
  end: number;
  type: PiiType;
  confidence: number;
}

export interface Detector {
  name: string;
  /** 0 = patterns, 1 = light CPU model, 2 = accelerated model. */
  tier: 0 | 1 | 2;
  detect(text: string, level: PrivacyLevel): Promise<Span[]>;
}
