// Process tree listing and killing for stdio servers.
// The SDK transport spawns without `detached`, so the server shares the gateway's
// process group. Unix walks the parent links instead; Windows uses taskkill /T.
import { readdirSync, readFileSync } from "node:fs";

/** PIDs of every descendant of `pid` (children, grandchildren, ...). Unix only. */
export function descendants(pid: number): number[] {
  const parents = parentMap();
  const children = new Map<number, number[]>();
  for (const [child, parent] of parents) {
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  }
  const out: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const next = children.get(queue.shift() as number) ?? [];
    for (const c of next) {
      if (c === pid || out.includes(c)) continue;
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** child pid -> parent pid, from `ps`, or /proc when `ps` is missing (slim Linux images). */
function parentMap(): Map<number, number> {
  const map = new Map<number, number>();
  try {
    const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="], {
      env: { PATH: "/bin:/usr/bin" },
      stdout: "pipe",
      stderr: "ignore",
    });
    if (ps.success) {
      for (const line of ps.stdout.toString().split("\n")) {
        const [a, b] = line.trim().split(/\s+/).map(Number);
        if (a && b !== undefined && !Number.isNaN(b)) map.set(a, b);
      }
      return map;
    }
  } catch {
    // fall through to /proc
  }
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        // Format: pid (comm) state ppid ...; comm may contain spaces and parentheses.
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        map.set(Number(entry), ppid);
      } catch {
        // process exited while reading
      }
    }
  } catch {
    // no /proc either
  }
  return map;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Sends SIGKILL to each pid that is still alive. */
export function killAll(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** Windows: kills `pid` and everything it started. */
export async function taskkillTree(pid: number): Promise<void> {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  try {
    const proc = Bun.spawn([`${root}\\System32\\taskkill.exe`, "/T", "/F", "/PID", String(pid)], {
      env: { SystemRoot: root },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
    await proc.exited;
  } catch {
    // process already gone or taskkill missing
  }
}
