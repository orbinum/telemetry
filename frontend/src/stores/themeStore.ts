/**
 * Theme store — same contract as app/privacy-explorer.
 *
 * `applyTheme` runs at module scope, before React mounts, which is what
 * avoids the flash of the wrong theme on first paint.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import { STORAGE_KEYS, readStored, writeStored } from "../utils/storage";

export type Theme = "dark" | "light" | "system";

interface ThemeState {
  theme: Theme;
  /**
   * Set a theme explicitly. Nothing in this UI calls it today — the nav's
   * toggle only flips light/dark — but it is the only way back to "system",
   * which is the default a first-time visitor gets, and it keeps this store
   * the same contract as app/privacy-explorer.
   */
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme): void {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  // Swap favicon to match the effective theme.
  const effectiveLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((el) => {
    if (el.href.includes("isotipo")) {
      el.href = effectiveLight ? "/isotipo-black.svg" : "/isotipo-white.svg";
    }
  });
  writeStored(STORAGE_KEYS.theme, theme);
}

const stored =
  readStored(STORAGE_KEYS.theme, (raw) =>
    raw === "dark" || raw === "light" || raw === "system" ? (raw as Theme) : undefined,
  ) ?? "system";

// Before the first render — this is the anti-FOUC part.
applyTheme(stored);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: stored,

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const current = get().theme;
    // system/dark → light; light → dark
    const next: Theme = current === "light" ? "dark" : "light";
    applyTheme(next);
    set({ theme: next });
  },
}));

/**
 * The theme actually in effect, resolving "system" against the OS preference
 * and tracking OS changes — for assets that can't be styled with CSS vars.
 */
export function useEffectiveTheme(): "light" | "dark" {
  const theme = useThemeStore((s) => s.theme);
  const [systemLight, setSystemLight] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event: MediaQueryListEvent) => setSystemLight(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (theme === "system") return systemLight ? "light" : "dark";
  return theme;
}
