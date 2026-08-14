/**
 * What fills the page when there is nothing to show.
 *
 * "Nothing to show" is rarely the end of the story — the node list is empty
 * because a filter hides everything, or because no worker answered, or
 * because devnet needs a command run first. The optional `hint` is where that
 * next step goes, so an empty screen is never a dead end.
 */

import type { ReactNode } from "react";

interface EmptyStateProps {
  children: ReactNode;
  /** What the reader can do about it, when there is something to do. */
  hint?: ReactNode;
}

export function EmptyState({ children, hint }: EmptyStateProps) {
  return (
    <div className="glass-card px-4 py-10 text-center">
      <p className="text-sm text-muted">{children}</p>
      {hint !== undefined && <p className="mx-auto mt-3 max-w-xl text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** An error the user cannot fix by waiting, with the same optional hint. */
export function ErrorState({ children, hint }: EmptyStateProps) {
  return (
    <div className="bg-error-tint border-error-mix mb-5 border px-4 py-3 text-sm">
      <p className="text-error">{children}</p>
      {hint !== undefined && <p className="mt-2 text-muted">{hint}</p>}
    </div>
  );
}
