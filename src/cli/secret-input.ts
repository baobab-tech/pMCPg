// Secret prompts for the CLI. On a TTY the typed value is not echoed; piped stdin is read one line at a time.

/** The parts of a stdin stream the reader uses. `process.stdin` fits; tests pass a fake. */
export interface SecretInput {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  on(event: "data", fn: (chunk: Buffer | string) => void): unknown;
  on(event: "end" | "close", fn: () => void): unknown;
  on(event: "error", fn: (e: Error) => void): unknown;
  off(event: string, fn: (...args: never[]) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface SecretOutput {
  write(text: string): unknown;
}

export class SecretPromptCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_U = "\x15";
const BACKSPACE = "\x7f";
const CTRL_H = "\b";
const ESC = "\x1b";

/** Text read past the end of a line on a piped stream, kept for the next call. */
const leftover = new WeakMap<SecretInput, string>();

/**
 * Prompts for a secret and returns it trimmed. Throws when the value is empty or the user presses Ctrl-C.
 *
 * TTY: raw mode, nothing echoed per key. Handles backspace, Ctrl-U, pasted text (one chunk with many
 * characters) and skips arrow-key escape sequences. Raw mode is restored on every exit path.
 * Windows: Bun maps setRawMode to the console mode in Windows Terminal and conhost; Enter arrives as "\r".
 * Not run on Windows yet: whether conhost sends Ctrl-C as "\x03" in raw mode rather than raising SIGINT.
 *
 * Not a TTY: reads up to the next newline without echo handling, so `printf 'key\n' | pmcpg ...` works,
 * including several prompts in a row.
 */
export async function readSecret(
  label: string,
  input: SecretInput = process.stdin as unknown as SecretInput,
  output: SecretOutput = process.stderr,
): Promise<string> {
  const raw = input.isTTY && typeof input.setRawMode === "function";
  let value: string;
  if (raw) {
    output.write(`${label}: `);
    value = await readHidden(input, output);
  } else {
    value = await readLine(input);
  }
  value = value.trim();
  if (!value) throw new Error(`No value given for ${label}`);
  return value;
}

function readHidden(input: SecretInput, output: SecretOutput): Promise<string> {
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw === true;
    let value = "";
    let done = false;
    // Escape-sequence state: 0 = none, 1 = just read ESC, -1 = inside a CSI sequence such as an arrow key.
    let esc = 0;
    const decoder = new TextDecoder();

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      try {
        input.setRawMode?.(wasRaw);
      } finally {
        input.pause();
        output.write("\n");
        if (err) reject(err);
        else resolve(value);
      }
    };
    const onEnd = () => finish();
    const onError = (e: Error) => finish(e);
    const onData = (chunk: Buffer | string) => {
      for (const ch of typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })) {
        if (done) return;
        if (esc === 1) {
          esc = ch === "[" ? -1 : 0;
          continue;
        }
        if (esc === -1) {
          if (ch >= "@" && ch <= "~") esc = 0;
          continue;
        }
        if (ch === ESC) esc = 1;
        else if (ch === "\r" || ch === "\n") return finish();
        else if (ch === CTRL_C) return finish(new SecretPromptCancelled());
        else if (ch === CTRL_D) {
          if (!value) return finish(new SecretPromptCancelled());
          return finish();
        } else if (ch === BACKSPACE || ch === CTRL_H) value = [...value].slice(0, -1).join("");
        else if (ch === CTRL_U) value = "";
        else if (ch >= " ") value += ch;
      }
    };

    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
    try {
      input.setRawMode?.(true);
      input.resume();
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function readLine(input: SecretInput): Promise<string> {
  const take = (buf: string): string | undefined => {
    const i = buf.indexOf("\n");
    if (i < 0) return undefined;
    leftover.set(input, buf.slice(i + 1));
    return buf.slice(0, i).replace(/\r$/, "");
  };
  const ready = take(leftover.get(input) ?? "");
  if (ready !== undefined) return Promise.resolve(ready);

  return new Promise((resolve, reject) => {
    let buf = leftover.get(input) ?? "";
    leftover.delete(input);
    const decoder = new TextDecoder();
    let done = false;
    const finish = (line: string | undefined, err?: Error) => {
      if (done) return;
      done = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("close", onEnd);
      input.off("error", onError);
      input.pause();
      if (err) reject(err);
      else resolve(line ?? "");
    };
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const line = take(buf);
      if (line !== undefined) finish(line);
    };
    const onEnd = () => finish(buf.replace(/\r$/, ""));
    const onError = (e: Error) => finish(undefined, e);
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("close", onEnd);
    input.on("error", onError);
    input.resume();
  });
}
