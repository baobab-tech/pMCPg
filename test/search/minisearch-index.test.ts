import { describe, expect, test } from "bun:test";
import { MiniSearchToolIndex, tokenize } from "../../src/search/minisearch-index.ts";
import { catalogue, QUALITY_SET } from "./catalogue.ts";

function index() {
  const ix = new MiniSearchToolIndex();
  ix.setTools("all", catalogue());
  return ix;
}

describe("MiniSearchToolIndex", () => {
  test("tokenize splits qualified names, snake and camel case", () => {
    expect(tokenize("gmail-work__sendEmail_now")).toEqual(["gmail", "work", "send", "Email", "now"]);
  });

  test("default limit 5, max 10, min 1", () => {
    const ix = index();
    expect(ix.search("file", "file").length).toBe(0);
    expect(ix.search("all", "file").length).toBe(5);
    expect(ix.search("all", "file", 50).length).toBe(10);
    expect(ix.search("all", "file", 0).length).toBe(1);
    expect(ix.search("all", "   ")).toEqual([]);
  });

  test("get by qualified name, per profile", () => {
    const ix = index();
    ix.setTools(
      "work",
      catalogue().filter((t) => t.accountId === "slack"),
    );
    expect(ix.get("all", "gmail__send_email")?.toolName).toBe("send_email");
    expect(ix.get("work", "gmail__send_email")).toBeUndefined();
    expect(ix.search("work", "send email").every((t) => t.accountId === "slack")).toBe(true);
  });

  test("setTools replaces the previous set", () => {
    const ix = index();
    ix.setTools("all", []);
    expect(ix.search("all", "email")).toEqual([]);
    expect(ix.get("all", "gmail__send_email")).toBeUndefined();
  });

  test("prefix and light fuzzy matching", () => {
    const ix = index();
    expect(ix.search("all", "calend")[0]?.accountId).toBe("calendar");
    expect(ix.search("all", "spreadshet").map((t) => t.qualifiedName)).toContain("drive__update_spreadsheet");
  });

  test("search quality: top-5 recall >= 90%", () => {
    const ix = index();
    const misses = QUALITY_SET.filter(
      ([prompt, expected]) => !ix.search("all", prompt).some((t) => t.qualifiedName === expected),
    );
    const recall = 1 - misses.length / QUALITY_SET.length;
    if (misses.length) console.log("search misses:", misses);
    expect(catalogue().length).toBeGreaterThanOrEqual(55);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});
