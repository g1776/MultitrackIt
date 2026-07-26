import type { TimestampedEngineEvent } from "../engine/events";

/**
 * A requested interval alongside what actually elapsed, as measured from the
 * engine's own event timestamps. Both are stated: reporting only the
 * requested figure would be reporting an intention, and reporting only the
 * measured one leaves no way to see that it was wrong.
 */
export interface IntervalMeasurement {
  requestedMs: number | null;
  /** Elapsed time between the started/ended events, or null if the pass didn't reach both. */
  actualMs: number | null;
}

export interface CountInMeasurement extends IntervalMeasurement {
  bars: number | null;
  beats: number | null;
}

/**
 * A written record of one recording or playback pass: the Project it ran
 * against, the lead-in as both asked for and measured, and the full event
 * timeline including every schedule entry's computed start time and
 * originating Offset (ADR 0004).
 */
export interface DiagnosticsReport {
  /** ISO 8601 wall-clock time the report was written — the report's identity, and its file name. */
  createdAt: string;
  project: {
    name: string;
    tempoBpm: number;
    beatsPerBar: number;
  } | null;
  padding: IntervalMeasurement;
  countIn: CountInMeasurement;
  events: TimestampedEngineEvent[];
}

/**
 * Seam between diagnostics reporting and actual disk storage, mirroring
 * `ProjectStorageAdapter`. Kept separate from Project persistence
 * deliberately: that seam is about Project snapshots and their media, and
 * widening it would make the app's persistence contract carry a diagnostics
 * concern.
 */
export interface DiagnosticsStorageAdapter {
  /** Writes a report, returning the repository-relative path it was written to. */
  writeReport(report: DiagnosticsReport): Promise<string>;
}
