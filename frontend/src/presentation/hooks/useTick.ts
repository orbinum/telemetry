/**
 * Re-renders once a second so relative-time labels stay fresh, on the
 * *server's* clock: feed timestamps are server-stamped, so a browser clock
 * that is off would skew every "N seconds ago" label. Corrected here because
 * this is the only place the app reads a wall clock.
 */

import { useEffect, useState } from "react";
import { useClockOffset } from "../../stores/feedStore";

export function useTick(intervalMs = 1000): number {
  const offset = useClockOffset();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now + offset;
}
