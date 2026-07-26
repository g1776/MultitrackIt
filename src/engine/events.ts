import type { TakeId, TrackId } from "./types";

/**
 * One schedule entry as the engine handed it to the playback adapter, paired
 * with the Take Offset it was computed from. The Offset is carried alongside
 * the computed `startAtMs` rather than left to be inferred, because the whole
 * point of the diagnostics timeline is that lead-in and sync arithmetic is
 * *stated* data: two offsetting errors can cancel into a plausible-looking
 * start time while the performer's experience is plainly wrong (ADR 0004).
 */
export interface ScheduledEntryRecord {
  takeId: TakeId | "guide";
  /** Milliseconds from the start of playback this entry was scheduled at. */
  startAtMs: number;
  /**
   * The Take's stored Offset that `startAtMs` was derived from — 0 for the
   * Guide, which always sits at the timeline's zero point, and null if the
   * Take couldn't be found. Null rather than 0 for that case precisely
   * because this is the field the report exists to state: a fabricated 0
   * would be indistinguishable from a genuine zero Offset.
   */
  offsetMs: number | null;
}

/** Which pass a schedule/playback event belongs to. */
export type PlaybackPurpose = "monitor-mix" | "composite";

/**
 * A lifecycle event the recording engine emits, before it has been
 * timestamped. The engine deliberately states no time here: stamping is the
 * sink's job (see `EngineEventSink`).
 */
export type EngineEvent =
  | { type: "padding-started"; requestedDurationMs: number }
  | { type: "padding-ended" }
  | { type: "count-in-started"; requestedDurationMs: number; beats: number; bars: number }
  | { type: "count-in-ended" }
  | { type: "capture-started"; trackId: TrackId }
  | { type: "capture-stopped"; trackId: TrackId; takeId: TakeId; offsetMs: number }
  | { type: "schedule-built"; purpose: PlaybackPurpose; entries: ScheduledEntryRecord[] }
  | { type: "playback-started"; purpose: PlaybackPurpose }
  | { type: "playback-stopped"; purpose: PlaybackPurpose };

/** An `EngineEvent` once a sink has stamped it with the time it was observed. */
export type TimestampedEngineEvent = EngineEvent & {
  /** Milliseconds on the sink's clock. Only differences between events are meaningful; the origin is arbitrary. */
  atMs: number;
};

/**
 * Optional observer of the recording engine's lifecycle. Nothing consumes it
 * during normal operation — it exists so the diagnostics panel can report
 * what actually happened during a pass.
 *
 * The sink **stamps its own timestamps**. The engine has no clock dependency
 * of its own, and rather than introducing a separate clock seam alongside
 * this one, observation and clock are folded into a single injection point:
 * the production sink reads the real `AudioContext` that drives playback, so
 * timeline entries are directly comparable to scheduling decisions, while a
 * fake sink stamps deterministically for tests.
 */
export interface EngineEventSink {
  record(event: EngineEvent): void;
}
