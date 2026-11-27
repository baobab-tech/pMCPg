/** Line diff: lines only in `before` are marked -, only in `after` +. */
export function diffLines(before: string, after: string): { sign: " " | "-" | "+"; text: string }[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { sign: " " | "-" | "+"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ sign: " ", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ sign: "-", text: a[i++] });
    else out.push({ sign: "+", text: b[j++] });
  }
  while (i < m) out.push({ sign: "-", text: a[i++] });
  while (j < n) out.push({ sign: "+", text: b[j++] });
  return out;
}

/** Old and new text, line by line: removed lines struck through, added lines highlighted. */
export function LineDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {lines.map((l, k) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no id
          key={k}
          className={
            l.sign === "+"
              ? "bg-brand/10 text-brand"
              : l.sign === "-"
                ? "bg-destructive/10 text-destructive line-through decoration-destructive/40"
                : ""
          }
        >
          {l.sign} {l.text}
        </div>
      ))}
    </pre>
  );
}
