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
 * Where capture actually began, relative to where the Project timeline says
 * its zero point is.
 *
 * The Count-in ending *is* the timeline's zero point (`CONTEXT.md`, ADR
 * 0003) — it is where the Guide's first beat sits and what every Take's
 * Offset is measured from. Capture is supposed to begin at that same
 * instant, so this number is supposed to be zero. It is stated rather than
 * left to be worked out from the difference between two events, because a
 * reader subtracting timestamps by hand is exactly the residual reasoning
 * ADR 0004 rejects: a non-zero value here means every Take in the pass is
 * displaced from the Guide by that much, and that is too load-bearing a fact
 * to leave implicit.
 */
export interface CaptureStartMeasurement {
  /** ms between the Count-in ending and capture actually starting. Null if the pass didn't reach both. */
  delayAfterCountInMs: number | null;
}

/**
 * Identifies the `AudioContext` whose clock stamped a report's timestamps.
 *
 * Every `atMs` in a report counts from this context's creation, so the
 * origin is only shared between reports carrying the same `sessionId`.
 * Stating it makes "was this a cold start or a warm one?" a matter of
 * comparing ids across reports, rather than inferring it from whether the
 * first event happens to sit near zero — the warm multi-Take case is the one
 * real sessions are made of, and it should not be guessed at.
 */
export interface AudioClockSession {
  sessionId: string;
  /** Wall-clock time (epoch ms) the AudioContext was created — the instant `atMs: 0` corresponds to. */
  createdAtEpochMs: number;
}

/**
 * What the pass ran against. The Guide is stated explicitly, including when
 * there isn't one, because its absence is otherwise invisible: a Project with
 * no Guide, and one whose Guide is excluded from the Monitor Mix, both
 * produce a schedule with no Guide entry — identical to having forgotten to
 * import or generate one. Since the Guide is what sits at the timeline's zero
 * point, a run without it measures a different offset path than normal use
 * (ADR 0004), so a report that can't distinguish the two is misleading.
 */
export interface ProjectSummary {
  name: string;
  tempoBpm: number;
  beatsPerBar: number;
  guide: {
    /** Whether the Guide is audible in the Monitor Mix — i.e. whether it sounded during a recording pass. */
    includeInMonitorMix: boolean;
    /** Whether the Guide is unmuted in composite playback — i.e. whether it sounded during a playback pass. */
    includeInMixdown: boolean;
  } | null;
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
  project: ProjectSummary | null;
  /** The clock every `atMs` below was stamped against. Null before any AudioContext exists. */
  audioClock: AudioClockSession | null;
  padding: IntervalMeasurement;
  countIn: CountInMeasurement;
  captureStart: CaptureStartMeasurement;
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
