import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Every crawler may read every page, llms.txt included.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
