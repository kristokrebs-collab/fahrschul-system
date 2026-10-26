import { useEffect, useState } from "react";

/** `Date.now()` that re-renders at the start of every minute (countdowns, "gleich", the briefing's stand). */
export function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      t = setTimeout(() => {
        setNow(Date.now());
        arm();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  return now;
}
