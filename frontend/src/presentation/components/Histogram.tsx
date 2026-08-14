/**
 * Live histogram — counts of one categorical field across the visible nodes.
 *
 * Bars are proportional to the largest bucket, which is what makes the shape
 * readable at a glance; the count and percentage carry the precision.
 */

interface HistogramProps {
  title: string;
  /** Label → count, unsorted; the component ranks and truncates. */
  buckets: Map<string, number>;
  /** Rows to show before collapsing the tail into "other". */
  limit?: number;
}

export function Histogram({ title, buckets, limit = 8 }: HistogramProps) {
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  const head = ranked.slice(0, limit);
  const tail = ranked.slice(limit);
  const rows =
    tail.length > 0
      ? [...head, [`other (${tail.length})`, tail.reduce((s, [, c]) => s + c, 0)] as const]
      : head;
  const max = rows[0]?.[1] ?? 1;

  return (
    <section className="glass-card relative overflow-hidden p-4">
      <div className="edge-accent absolute inset-x-0 top-0 h-px" />
      <h2 className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted">{title}</h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map(([label, count]) => (
            <li
              key={label}
              className="grid grid-cols-[minmax(6rem,1fr)_3fr_auto] items-center gap-3"
            >
              <span className="truncate text-xs text-text" title={label}>
                {label}
              </span>
              <span className="h-1.5 bg-muted-tint">
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </span>
              <span className="text-right text-xs tabular-nums text-muted">
                {count}
                <span className="ml-1.5 opacity-60">
                  {total === 0 ? "" : `${Math.round((count / total) * 100)}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
