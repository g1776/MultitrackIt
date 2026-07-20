export interface MetronomeClick {
  /** Milliseconds from the start of the guide. */
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

  const beatIntervalMs = 60000 / bpm;
  const clicks: MetronomeClick[] = [];
  let beatIndex = 0;
  for (let atMs = 0; atMs < durationMs; atMs += beatIntervalMs, beatIndex++) {
    clicks.push({ atMs, accent: beatIndex % beatsPerBar === 0 });
  }
  return clicks;
}
