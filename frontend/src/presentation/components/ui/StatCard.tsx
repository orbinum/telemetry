/** A single headline number: label above, value below. */

interface StatCardProps {
  label: string;
  value: string;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="glass-card relative overflow-hidden px-4 py-3">
      <div className="edge-accent absolute inset-x-0 top-0 h-px" />
      <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-accent">{value}</div>
    </div>
  );
}

/** The four-across row both the header and the stats page use. */
export function StatCardRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}
