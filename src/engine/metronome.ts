/** One click of a click track — a generated metronome Guide, or a Count-in. */
export interface MetronomeClick {
  /** Milliseconds from the start of the click track. */
  atMs: number;
  /** True for the first beat of each bar (typically accented/louder). */
  accent: boolean;
}

export interface MetronomeParams {
  bpm: number;
  /** Beats per bar (the numerator of the time signature, e.g. 4 for 4/4). */
  beatsPerBar: number;
  durationMs: number;
}

/**
 * Pure schedule computation for a metronome click track: one click per beat,
 * accenting the first beat of each bar, for the given duration. Decoupled
 * from actual audio synthesis so the timing logic can be unit-tested without
 * Web Audio APIs.
 */
export function computeMetronomeClicks(params: MetronomeParams): MetronomeClick[] {
  const { bpm, beatsPerBar, durationMs } = params;
  if (bpm <= 0) throw new Error("bpm must be positive");
  if (beatsPerBar <= 0) throw new Error("beatsPerBar must be positive");
  if (durationMs <= 0) return [];

  // Beat times are computed as `index * beatInterval` rather than
  // accumulated: over a Guide minutes long, a tempo whose beat interval
  // isn't exact in binary would otherwise drift audibly against the Takes
  // recorded to it. Same reasoning as `computeCountIn`.
  const beatIntervalMs = 60000 / bpm;
  const beatCount = Math.ceil(durationMs / beatIntervalMs);
  return Array.from({ length: beatCount }, (_, beatIndex) => ({
    atMs: beatIndex * beatIntervalMs,
    accent: beatIndex % beatsPerBar === 0,
  }));
}
