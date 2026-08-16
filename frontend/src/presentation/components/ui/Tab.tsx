/**
 * The pill used for every in-page selector: networks, chains, views.
 *
 * They look identical on purpose — one visual language for "pick one of
 * these" — but come in two flavours because a network is app state while a
 * chain or a view is a URL.
 */

import { NavLink } from "react-router";
import type { ReactNode } from "react";
import { cn } from "./cn";

const BASE = "border px-3 py-1 font-sans text-xs transition-colors";
const ACTIVE = "border-accent-mix bg-accent-tint text-accent";
const INACTIVE = "border-border text-muted hover:text-accent";

/** Not exported: the two components below are the API, and a file that
 * exports anything else loses Fast Refresh. */
function tabClass(isActive: boolean, className?: string): string {
  return cn(BASE, isActive ? ACTIVE : INACTIVE, className);
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** A tab that changes state rather than navigating. */
export function TabButton({ active, onClick, title, className, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={tabClass(active, className)}
    >
      {children}
    </button>
  );
}

interface TabLinkProps {
  to: string;
  /** Match the path exactly, so a parent route is not active on its children. */
  end?: boolean;
  children: ReactNode;
}

/** A tab that navigates, so the view is shareable as a URL. */
export function TabLink({ to, end, children }: TabLinkProps) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => tabClass(isActive)}>
      {children}
    </NavLink>
  );
}
