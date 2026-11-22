import { afterEach, describe, expect, test } from "bun:test";
import pkg from "../../package.json";
import type { ToolRef } from "../../src/core/types.ts";
import {
  MENU_LINE_CHARS,
  MENU_MAX_TOOLS,
  menuSummary,
  toolMenu,
  VERSION,
} from "../../src/frontdoor/server.ts";
import { FakeConnector, type Harness, startFrontDoor, toolRef } from "./helpers.ts";

const obj = () => ({ type: "object" as const, properties: {} });
const ref = (account: string, name: string, description = "", title?: string): ToolRef =>
  toolRef(account, { name, description, inputSchema: obj(), ...(title ? { title } : {}) });

let h: Harness | undefined;
afterEach(async () => {
  await h?.stop();
  h = undefined;
});

describe("menuSummary", () => {
  test("first sentence, one line, no trailing period", () => {
    expect(menuSummary({ description: "Send an email.\nSupports  HTML. Rate limited." })).toBe(
      "Send an email",
    );
  });
  test("abbreviations do not end the sentence", () => {
    expect(menuSummary({ description: "Append lines, e.g. a log entry. More here." })).toBe(
      "Append lines, e.g. a log entry",
    );
    expect(menuSummary({ description: "Uses v1.2 of the API. Then more." })).toBe("Uses v1.2 of the API");
  });
  test("falls back to the title", () => {
    expect(menuSummary({ description: "", title: "Post message" })).toBe("Post message");
  });
  test("cuts long text", () => {
    const s = menuSummary({ description: "x".repeat(500) });
    expect(s.length).toBe(MENU_LINE_CHARS);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("toolMenu", () => {
  test("one sorted line per tool", () => {
    const menu = toolMenu([ref("slack", "post", "Post a message."), ref("mail", "send", "Send an email.")]);
    expect(menu).toBe("Tools available (2):\n- mail__send: Send an email\n- slack__post: Post a message");
  });
  test("a tool without text gets its name alone", () => {
    expect(toolMenu([ref("mail", "ping")])).toBe("Tools available (1):\n- mail__ping");
  });
  test("empty", () => {
    expect(toolMenu([])).toBe("No tools are connected yet.");
  });
  test("above the cap, one line per account", () => {
    const many = Array.from({ length: MENU_MAX_TOOLS + 1 }, (_, i) => ref("big", `t${i}`, "Does a thing."));
    const menu = toolMenu([...many, ref("mail", "send", "Send an email.")]);
    const lines = menu.split("\n");
    expect(lines[0]).toContain(`Tools available (${MENU_MAX_TOOLS + 2}, grouped by account`);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toStartWith(`- big (${MENU_MAX_TOOLS + 1} tools): t0, t1`);
    expect(lines[1]?.length).toBeLessThanOrEqual(200);
    expect(lines[2]).toBe("- mail (1 tools): send");
  });
});

describe("search_tools description", () => {
  const mail = () =>
    new FakeConnector("mail", [
      { name: "send_email", description: "Send an email to a recipient.", inputSchema: obj() },
    ]);

  test("carries the menu for the connecting profile", async () => {
    const tools = new Map([["all", [ref("mail", "send_email", "Send an email to a recipient.")]]]);
    h = await startFrontDoor([mail()], { listTools: (id) => tools.get(id) ?? [] });
    const c = await h.connect();
    const search = (await c.listTools()).tools.find((t) => t.name === "search_tools");
    expect(search?.description).toContain("Find tools for a task.");
    expect(search?.description).toContain("- mail__send_email: Send an email to a recipient");
  });

  test("reflects tool changes on the next list", async () => {
    let tools: ToolRef[] = [];
    h = await startFrontDoor([mail()], { listTools: () => tools });
    const c = await h.connect();
    const desc = async () => (await c.listTools()).tools.find((t) => t.name === "search_tools")?.description;
    expect(await desc()).toContain("No tools are connected yet.");
    tools = [ref("mail", "send_email", "Send an email.")];
    expect(await desc()).toContain("- mail__send_email: Send an email");
  });

  test("no menu without listTools", async () => {
    h = await startFrontDoor([mail()]);
    const c = await h.connect();
    const search = (await c.listTools()).tools.find((t) => t.name === "search_tools");
    expect(search?.description).not.toContain("Tools available");
  });

  test("reports the package version", async () => {
    expect(VERSION).toBe(pkg.version);
    h = await startFrontDoor([mail()]);
    const c = await h.connect();
    expect(c.getServerVersion()?.version).toBe(pkg.version);
  });
});
