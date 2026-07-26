import type { MetronomeClick } from "./metronome";

export interface CountInParams {
  bpm: number;
  /** Beats per bar (the time signature's numerator, e.g. 4 for 4/4). */
  beatsPerBar: number;
  /** Whole bars to count in for (0 is allowed: padding only, no clicks). */
  bars: number;
  /** Fixed silent Count-in Padding preceding the first counted beat. */
  paddingMs: number;
}

/**
 * The recording lead-in, fully derived: how long the silent "get ready"
 * padding lasts, how long the Count-in lasts, and where each counted beat
 * falls within it (relative to the first counted beat, not to the start of
 * the padding).
 */
export interface CountInPlan {
  paddingMs: number;
  countInMs: number;
  /** Padding + Count-in: how long after starting a recording capture begins. */
  leadInMs: number;
  clicks: MetronomeClick[];
}

/**
 * Derives the lead-in before capture from the Project's tempo and time
 * signature (see Count-in and Count-in Padding in `CONTEXT.md`, ADR 0003).
 * The Count-in is a whole number of bars at that tempo rather than a fixed
 * duration, so it lands on beats at every tempo instead of mid-bar; the
 * padding is a fixed silent interval applied unconditionally before it, so
 * the gap between starting a recording and the first counted beat is the
 * same every time and can be learned.
 *
 * Beat times are computed as `index * beatInterval` rather than accumulated,
 * so a tempo whose beat interval isn't exact in binary (e.g. 90bpm) can't
 * drift into an extra or missing final beat.
 */
export function computeCountIn(params: CountInParams): CountInPlan {
  const { bpm, beatsPerBar, bars, paddingMs } = params;
  if (!(bpm > 0)) throw new Error("bpm must be positive");
  if (!(beatsPerBar > 0)) throw new Error("beatsPerBar must be positive");
  if (!Number.isInteger(bars) || bars < 0) {
    throw new Error("bars must be a non-negative whole number");
  }
  if (!(paddingMs >= 0)) throw new Error("paddingMs must not be negative");

  const beatIntervalMs = 60000 / bpm;
  const beatCount = bars * beatsPerBar;
  const clicks: MetronomeClick[] = Array.from({ length: beatCount }, (_, index) => ({
    atMs: index * beatIntervalMs,
    accent: index % beatsPerBar === 0,
  }));
  const countInMs = beatCount * beatIntervalMs;

  return { paddingMs, countInMs, leadInMs: paddingMs + countInMs, clicks };
}
