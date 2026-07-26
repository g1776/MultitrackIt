import { useEffect, useState } from "react";
import { useTransportStore } from "../store/useTransportStore";

/**
 * The lead-in made visible: a silent "get ready" state while the Count-in
 * Padding primes the playback clock, then the counted beats themselves,
 * ticking up as they sound. The beat times come from the engine's own
 * Count-in plan (via the transport store) rather than a duration recomputed
 * here, so the beats shown are the ones the engine sounds and times capture
 * against — displayed on a UI timer, so this is a readout of that plan, not
 * a second clock anything is scheduled from.
 */
export function CountIn() {
  const leadInPhase = useTransportStore((s) => s.leadInPhase);
  const clicks = useTransportStore((s) => s.countInClicks);
  const [beatsElapsed, setBeatsElapsed] = useState(0);

  const isCountingIn = leadInPhase === "counting-in";

  useEffect(() => {
    if (!isCountingIn) {
      setBeatsElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      setBeatsElapsed(clicks.filter((click) => click.atMs <= elapsedMs).length);
    };
    tick();
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [isCountingIn, clicks]);

  if (!leadInPhase) return null;

  return (
    <p role="status" className="status">
      {isCountingIn ? `Count-in: ${beatsElapsed} / ${clicks.length}` : "Get ready…"}
    </p>
  );
}
