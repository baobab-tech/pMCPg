// Claude Desktop screens for the "move your Claude connectors" articles, redrawn so they follow the
// theme and read as text. Letter tiles stand in for logos. The ring marks what to click.

const panel = "rounded-xl border border-zinc-300 bg-zinc-50 p-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800";
const item = "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]";
const hit = "ring-2 ring-brand ring-offset-1 ring-offset-zinc-50 dark:ring-offset-zinc-800";
const muted = "text-zinc-500 dark:text-zinc-400";

function Tile({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="grid size-5 shrink-0 place-items-center rounded-[5px] text-[9px] font-bold text-white"
      style={{ background: color }}
    >
      {label}
    </span>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`ml-auto flex h-4.5 w-8 shrink-0 items-center rounded-full p-0.5 ${on ? "justify-end bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
    >
      <span className="size-3.5 rounded-full bg-white" />
    </span>
  );
}

/** + menu → Plugins → Manage plugins. */
export function ClaudeManagePlugins() {
  return (
    <div className="flex flex-wrap items-end gap-2 text-zinc-900 dark:text-zinc-100">
      <div className={`${panel} w-52`}>
        <div className={item}>Upload or add files</div>
        <div className={item}>Add folder</div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <div className={`${item} bg-zinc-200/70 dark:bg-zinc-700 ${hit}`}>
          Plugins<span className={`ml-auto ${muted}`}>›</span>
        </div>
        <div className={item}>Research</div>
      </div>
      <div className={`${panel} w-56`}>
        <div className={`${item} ${muted}`}>Search plugins</div>
        <div className={item}>
          <Tile label="F" color="#a259ff" />
          Figma
          <Toggle on />
        </div>
        <div className={item}>
          <Tile label="L" color="#5e6ad2" />
          Linear
          <Toggle on />
        </div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <div className={`${item} bg-zinc-200/70 dark:bg-zinc-700 ${hit}`}>
          Manage plugins<span className={`ml-auto ${muted}`}>↗</span>
        </div>
      </div>
    </div>
  );
}

/** A connector's row, opened: Connector URL with the copy button. */
export function ClaudeCopyUrl() {
  return (
    <div className={`${panel} w-full max-w-lg p-3 text-zinc-900 dark:text-zinc-100`}>
      <div className="flex items-center gap-2.5 text-sm">
        <Tile label="F" color="#a259ff" />
        Figma
        <span className={`ml-auto text-xs ${muted}`}>Not connected</span>
        <span className="rounded-md bg-zinc-200 px-2.5 py-1 text-xs dark:bg-zinc-700">Connect</span>
      </div>
      <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className={muted}>Connector URL</dt>
        <dd className="flex flex-wrap items-center gap-2 break-all">
          https://mcp.figma.com/mcp
          <span className={`rounded-md bg-zinc-200 px-1.5 text-xs dark:bg-zinc-700 ${hit}`}>Copy server URL</span>
        </dd>
        <dt className={muted}>Tools</dt>
        <dd className={muted}>generate_diagram, get_screenshot, … Show all 9</dd>
        <dt className={muted}>Sign-in</dt>
        <dd>Required</dd>
      </dl>
    </div>
  );
}

/** + → Plugins after the move: moved connectors off, pmcpg on. */
export function ClaudeTurnOff() {
  return (
    <div className={`${panel} w-64 text-zinc-900 dark:text-zinc-100`}>
      <div className={`${item} ${muted}`}>Search plugins</div>
      <div className={item}>
        <Tile label="F" color="#a259ff" />
        Figma
        <Toggle on={false} />
      </div>
      <div className={item}>
        <Tile label="L" color="#5e6ad2" />
        Linear
        <Toggle on={false} />
      </div>
      <div className={`${item} ${hit}`}>
        <Tile label="P" color="#1f8fb0" />
        pmcpg
        <Toggle on />
      </div>
    </div>
  );
}
