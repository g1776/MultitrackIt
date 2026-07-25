import { useEffect, useState } from "react";
import { DEFAULT_COUNT_IN_MS } from "../../src/engine/RecordingEngine";

/**
 * Visible Count-in shown between triggering a recording and capture
 * actually starting (see Count-in, `CONTEXT.md`, ADR 0002) — a fixed,
 * predictable countdown so the performer knows recording hasn't silently
 * started. Purely presentational: the engine's own Count-in delay
 * (`DEFAULT_COUNT_IN_MS`) is the actual gate on when capture starts; this
 * just ticks a local countdown down over the same duration for display.
 */
export function CountIn() {
  const [remainingMs, setRemainingMs] = useState(DEFAULT_COUNT_IN_MS);

  useEffect(() => {
    setRemainingMs(DEFAULT_COUNT_IN_MS);
    const start = Date.now();
    const interval = setInterval(() => {
      setRemainingMs(Math.max(0, DEFAULT_COUNT_IN_MS - (Date.now() - start)));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <p role="status" className="status">
      Recording starts in {remainingSeconds}…
    </p>
  );
}
