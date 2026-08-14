/** Shell: brand nav + routed content. Mirrors app's nav-glass header. */

import { Link, Outlet } from "react-router";
import { NetworkSwitcher } from "../components/NetworkSwitcher";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useEffectiveTheme } from "../../stores/themeStore";

export function AppLayout() {
  // The isotipo is a solid-color SVG, so it needs the opposite-of-background
  // variant rather than a CSS filter.
  const isLight = useEffectiveTheme() === "light";

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="nav-glass sticky top-0 z-20">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src={isLight ? "/isotipo-black.svg" : "/isotipo-white.svg"}
              alt=""
              className="h-6 w-auto"
            />
            <span className="font-sans text-sm font-semibold tracking-tight text-accent">
              Orbinum <span className="font-normal text-muted">Telemetry</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <NetworkSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
