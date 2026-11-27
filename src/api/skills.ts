// UI API routes for skills: the library, server skills and their review. Built only against GatewayHandle.
// Mounted under /api/ui by routes.ts, behind its Host/Origin, session and CSRF checks.
import type { Hono } from "hono";
import { z } from "zod";
import { SkillName, Slug } from "../core/config.ts";
import type { GatewayHandle } from "../gateway/handle.ts";
import { asText } from "../skills/files.ts";
import { SkillError, type SkillFileInput } from "../skills/skills.ts";
import { clientAddress, type UiAuth } from "./auth.ts";

/** One file as the UI sends it: text, or base64 for binary files. */
const FileBody = z.union([
  z.object({ path: z.string().min(1).max(500), text: z.string() }),
  z.object({ path: z.string().min(1).max(500), base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
]);
const Files = z.array(FileBody).min(1).max(512);

function toInputs(files: z.infer<typeof Files>): SkillFileInput[] {
  return files.map((f) =>
    "text" in f
      ? { path: f.path, content: new TextEncoder().encode(f.text) }
      : { path: f.path, content: Uint8Array.from(Buffer.from(f.base64, "base64")) },
  );
}

export function registerSkillRoutes(api: Hono, handle: GatewayHandle, auth: UiAuth): void {
  const skills = () => {
    if (!handle.skills) throw new SkillError(["Skills are not available."]);
    return handle.skills;
  };
  const fail = (e: unknown) => {
    if (e instanceof SkillError) return { error: e.message };
    throw e;
  };

  api.get("/skills", (c) => {
    if (!handle.skills) return c.json({ available: false, library: [], server: [], reviews: 0 });
    return c.json({
      available: true,
      library: handle.skills.library(),
      server: handle.skills.server(),
      reviews: handle.skills.reviews().filter((r) => r.status === "pending").length,
    });
  });

  /** One library skill with its file contents, for editing. */
  api.get("/skills/library/:name", (c) => {
    const name = c.req.param("name");
    const files = handle.skills?.readLibrary(name);
    if (!files) return c.json({ error: `No library skill named "${name}".` }, 404);
    return c.json({
      name,
      files: files.map((f) => {
        const text = asText(f.content);
        return text !== undefined
          ? { path: f.path, size: f.content.byteLength, text }
          : { path: f.path, size: f.content.byteLength, base64: Buffer.from(f.content).toString("base64") };
      }),
    });
  });

  api.post("/skills/library", async (c) => {
    const b = z.object({ name: SkillName, files: Files }).parse(await c.req.json());
    if (skills().readLibrary(b.name))
      return c.json({ error: `A skill named "${b.name}" already exists.` }, 409);
    try {
      return c.json(await skills().saveLibrary(b.name, toInputs(b.files)), 201);
    } catch (e) {
      return c.json(fail(e), 400);
    }
  });

  api.put("/skills/library/:name", async (c) => {
    const name = c.req.param("name");
    const b = z.object({ files: Files }).parse(await c.req.json());
    if (!skills().readLibrary(name)) return c.json({ error: `No library skill named "${name}".` }, 404);
    try {
      return c.json(await skills().saveLibrary(name, toInputs(b.files)));
    } catch (e) {
      return c.json(fail(e), 400);
    }
  });

  api.delete("/skills/library/:name", async (c) => {
    const b = z.object({ password: z.string().optional() }).parse(await c.req.json());
    await auth.confirm(b.password, clientAddress(c));
    try {
      await skills().removeLibrary(c.req.param("name"));
    } catch (e) {
      return c.json(fail(e), 404);
    }
    return c.json({ ok: true });
  });

  api.get("/skills/reviews", (c) =>
    c.json({ available: !!handle.skills, items: handle.skills?.reviews() ?? [] }),
  );

  api.post("/skills/reviews", async (c) => {
    const b = z
      .object({ account: Slug, path: z.string().min(1).max(500), decision: z.enum(["approve", "reject"]) })
      .parse(await c.req.json());
    try {
      if (b.decision === "approve") await skills().approve(b.account, b.path);
      else await skills().reject(b.account, b.path);
    } catch (e) {
      return c.json(fail(e), 404);
    }
    return c.json({ ok: true });
  });

  /** Fetch an account's skills again ("Check again" in the UI). */
  api.post("/skills/sync/:account", async (c) => {
    const id = c.req.param("account");
    if (!handle.config().accounts[id]) return c.json({ error: `No account named "${id}".` }, 404);
    await skills().sync(id);
    return c.json({ ok: true, skills: skills().server(id) });
  });
}
