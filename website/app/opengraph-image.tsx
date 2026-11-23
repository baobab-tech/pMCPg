import { ogAlt, ogCard, ogSize } from "@/lib/og-card";

export const alt = ogAlt;
export const size = ogSize;
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard("dark");
}
