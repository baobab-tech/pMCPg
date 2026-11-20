import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readSecret, type SecretInput, SecretPromptCancelled } from "../../src/cli/secret-input.ts";

class FakeStdin extends EventEmitter {
  isRaw = false;
  modes: boolean[] = [];
  paused = true;
  constructor(public isTTY: boolean) {
    super();
  }
  setRawMode(mode: boolean) {
    this.isRaw = mode;
    this.modes.push(mode);
    return this;
  }
  resume() {
    this.paused = false;
    return this;
  }
  pause() {
    this.paused = true;
    return this;
  }
  type(text: string) {
    this.emit("data", Buffer.from(text, "utf8"));
  }
}

function setup(isTTY: boolean) {
  const input = new FakeStdin(isTTY);
  const written: string[] = [];
  const output = { write: (t: string) => written.push(t) };
  const read = (label = "API key") => readSecret(label, input as unknown as SecretInput, output);
  return { input, written, read };
}

/** Lets readSecret attach its listeners before keys arrive. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("readSecret on a TTY", () => {
  test("typing is not echoed; raw mode restored", async () => {
    const { input, written, read } = setup(true);
    const p = read();
    await tick();
    for (const ch of "sk-123") input.type(ch);
    input.type("\r");
    expect(await p).toBe("sk-123");
    expect(written.join("")).toBe("API key: \n");
    expect(input.modes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listenerCount("data")).toBe(0);
  });

  test("backspace and Ctrl-U edit the value", async () => {
    const { input, read } = setup(true);
    const p = read();
    await tick();
    input.type("wrong\x15ab");
    input.type("cx\x7f");
    input.type("d\b\be\n");
    expect(await p).toBe("abe");
  });

  test("pasted text in one chunk, arrow keys skipped, multibyte split across chunks", async () => {
    const { input, read } = setup(true);
    const p = read();
    await tick();
    input.type("tok-\x1b[Dpasted\x1b[A");
    const euro = Buffer.from("€", "utf8");
    input.emit("data", euro.subarray(0, 1));
    input.emit("data", Buffer.concat([euro.subarray(1), Buffer.from("\r\rignored")]));
    expect(await p).toBe("tok-pasted€");
  });

  test("Ctrl-C aborts and restores the terminal", async () => {
    const { input, written, read } = setup(true);
    const p = read();
    await tick();
    input.type("secr\x03et\r");
    await expect(p).rejects.toBeInstanceOf(SecretPromptCancelled);
    expect(input.modes).toEqual([true, false]);
    expect(written.join("")).not.toContain("secr");
    expect(input.listenerCount("data")).toBe(0);
  });

  test("keeps raw mode when it was already on", async () => {
    const { input, read } = setup(true);
    input.isRaw = true;
    const p = read();
    await tick();
    input.type("x\r");
    await p;
    expect(input.modes).toEqual([true, true]);
  });

  test("stream end and errors restore the terminal", async () => {
    const a = setup(true);
    const pa = a.read();
    await tick();
    a.input.type("abc");
    a.input.emit("end");
    expect(await pa).toBe("abc");
    expect(a.input.isRaw).toBe(false);

    const b = setup(true);
    const pb = b.read();
    await tick();
    b.input.emit("error", new Error("boom"));
    await expect(pb).rejects.toThrow("boom");
    expect(b.input.isRaw).toBe(false);
  });

  test("empty value is an error", async () => {
    const { input, read } = setup(true);
    const p = read("Value for X");
    await tick();
    input.type("  \r");
    await expect(p).rejects.toThrow("No value given for Value for X");
  });
});

describe("readSecret on piped stdin", () => {
  test("reads one line per prompt, no prompt text, no raw mode", async () => {
    const { input, written, read } = setup(false);
    const p1 = read();
    await tick();
    input.type("first\r\nsecond\nthi");
    expect(await p1).toBe("first");
    expect(await read()).toBe("second");
    const p3 = read();
    await tick();
    input.type("rd");
    input.emit("end");
    expect(await p3).toBe("third");
    expect(written).toEqual([]);
    expect(input.modes).toEqual([]);
  });

  test("empty input is an error", async () => {
    const { input, read } = setup(false);
    const p = read();
    await tick();
    input.emit("end");
    await expect(p).rejects.toThrow("No value given");
  });
});
