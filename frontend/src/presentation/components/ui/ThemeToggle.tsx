/** Light/dark toggle — same behaviour as app's. */

import { Moon, Sun } from "lucide-react";
import { useEffectiveTheme, useThemeStore } from "../../../stores/themeStore";

export function ThemeToggle() {
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isLight = useEffectiveTheme() === "light";

  return (
    <button
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className="btn-ghost p-2"
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
