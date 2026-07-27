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

/** The browser audio processors a capture can be subjected to. */
export type AudioProcessingName = "echoCancellation" | "autoGainControl" | "noiseSuppression";

/**
 * One processor, as asked for and as the granted track actually reported it.
 * Both are stated for the same reason the intervals above state requested and
 * measured separately: a request is an intention, and constraint support
 * varies by platform and browser build, so what was asked for is no evidence
 * of what happened to the audio.
 */
export interface AudioProcessingControl {
  /** What capture asked for. Null when the constrained request was refused outright. */
  requestedEnabled: boolean | null;
  /** What the granted track reports. Null when this browser doesn't report the setting. */
  actualEnabled: boolean | null;
  /** Whether the device did what was asked. Null when either side is unknown. */
  honoured: boolean | null;
}

/**
 * A Take's provenance: whether it was captured raw or through voice-call
 * processing. Stated in the report rather than left to be inferred later from
 * how the audio looks (ADR 0004) — a conclusion about onset timing or dynamics
 * is worthless if it can't be told apart from automatic gain control riding
 * the level.
 */
export interface AudioProcessingState {
  /** Whether capture asked for unprocessed audio at all, or fell back to browser defaults. */
  constraintsRequested: boolean;
  controls: Record<AudioProcessingName, AudioProcessingControl>;
  /** Processors the device reports as on, whatever was asked for. */
  stillActive: AudioProcessingName[];
  /** Processors this browser said nothing about — neither confirmed off nor known on. */
  unreported: AudioProcessingName[];
  /** "unknown" when anything went unreported; "processed" wins over it if any processor is known on. */
  summary: "unprocessed" | "processed" | "unknown";
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
 * The parameters a synthetic sync scenario was run with (ADR 0004), so the
 * run is reproducible from its own report rather than from whatever
 * defaults happened to be current when it ran.
 */
export interface ScenarioSummary {
  trackCount: number;
  tempoBpm: number;
  beatsPerBar: number;
  beatCount: number;
  /** Simulated capture-device acquisition delay (ms) the run was made with; 0 for a healthy-device run. */
  armDelayMs: number;
  /** Simulated capture-device latency (ms) the run was made with; 0 for a healthy-device run. */
  simulatedLatencyMs: number;
}

/**
 * One Track's independent analysis: its own audio, decoded and onset-detected
 * on its own, so one Track's problem can't contaminate another's measurement
 * (ADR 0004). `expectedBeatTimesMs` comes from the same function that
 * generates the Guide, so the expectation and the audio can never disagree.
 */
export interface TrackAnalysis {
  trackId: string;
  /** Human-readable label (e.g. the Track's name), for a reader who hasn't memorised ids. */
  label: string;
  sampleRate: number;
  durationMs: number;
  expectedBeatTimesMs: number[];
  detectedOnsetsMs: number[];
  /** One entry per expected beat, in order. `null` where that beat was never detected. */
  perBeatErrorMs: (number | null)[];
  /** Indices into `expectedBeatTimesMs` that were never detected. */
  missingBeatIndices: number[];
  /** Detected onsets that matched no expected beat — a double-trigger or spurious noise, not a shifted error. */
  spuriousOnsetsMs: number[];
  /** Downsampled peak (max absolute) array, so audio the onset detector may have mishandled is still visible. */
  peaks: number[];
}

/**
 * The shared result of analysing every Track in a synthetic sync scenario.
 * Rendered by both the report and, in a later ticket, the on-screen canvas —
 * one object, so the screen and the file can never disagree (ADR 0004).
 */
export interface AnalysisResult {
  /**
   * The simulated capture-device latency the run was made with. Recorded
   * alongside the per-beat errors so a calibration run — one deliberately
   * made to report a known non-zero error — can never be mistaken for a
   * real measurement.
   */
  simulatedLatencyMs: number;
  tracks: TrackAnalysis[];
}

/**
 * Which kind of pass produced a report: an ordinary manual pass, a Mode B
 * synthetic-capture scenario alone, a Mode A acoustic-loopback run alone
 * (ADR 0004), or a `runFullDiagnosticsSuite` run covering calibration, Mode
 * B, and Mode A together (ADR 0006). Derived from which of
 * `scenario`/`loopback` is present, so a report can never disagree with
 * itself about what produced it.
 */
export type DiagnosticsMode = "manual" | "synthetic" | "loopback" | "full";

/**
 * The parameters a Mode A acoustic-loopback run was made with (ADR 0004), so
 * the run is reproducible from its own report.
 */
export interface LoopbackSummary {
  bpm: number;
  beatsPerBar: number;
  beatCount: number;
  /**
   * How many Takes were recorded in sequence against the shared Guide.
   * Optional/absent means 1 (a solo take) for reports written before this
   * field existed. A value above 1 means every Take after the first was
   * recorded while monitoring every earlier one *plus* the Guide together —
   * a real overdub, not just a Guide-only capture — since none of the
   * existing capture-only checks (Mode A, Mode B) ever recorded more than
   * one Take, and the app's actual overdub-monitoring condition is exactly
   * what none of them could catch.
   */
  trackCount?: number;
}

/**
 * Mode A's own analysis: the microphone capture treated as a single Track,
 * plus the round-trip latency figure derived from it. `roundTripLatencyMs`
 * is null exactly when `noOnsetsDetected` is true — a probable
 * headphones-or-muted-speakers condition must be stated plainly rather than
 * emitting a spurious offset (ADR 0004).
 */
export interface LoopbackAnalysisResult {
  track: TrackAnalysis;
  roundTripLatencyMs: number | null;
  noOnsetsDetected: boolean;
}

/**
 * A calibration pass's own result: a synthetic scenario run deliberately
 * made to report a known non-zero error (ADR 0006), and whether the harness
 * measured approximately that value. Present so a `runFullDiagnosticsSuite`
 * report can prove the instrument was validated before Mode B/Mode A ran,
 * rather than asking a reader to trust an undocumented discipline.
 */
export interface CalibrationSummary {
  /** The simulated capture-device latency (ms) the calibration pass injected. */
  injectedLatencyMs: number;
  /** Mean measured per-beat error (ms) across the calibration pass, or null if no beats were detected. */
  measuredMs: number | null;
  withinTolerance: boolean;
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
  mode: DiagnosticsMode;
  project: ProjectSummary | null;
  /** The clock every `atMs` below was stamped against. Null before any AudioContext exists. */
  audioClock: AudioClockSession | null;
  /** The processing the captured audio actually passed through. Null before any capture. */
  audioProcessing: AudioProcessingState | null;
  /** Present only for a `runFullDiagnosticsSuite` run; null for anything else. */
  calibration: CalibrationSummary | null;
  /** Present only for a synthetic sync scenario run; null for an ordinary manual pass. */
  scenario: ScenarioSummary | null;
  /** Present only once a synthetic scenario's Takes have been analysed; null otherwise. */
  analysis: AnalysisResult | null;
  /** Present only for a Mode A acoustic-loopback run; null otherwise. */
  loopback: LoopbackSummary | null;
  /** Present only once a loopback run's capture has been analysed; null otherwise. */
  loopbackAnalysis: LoopbackAnalysisResult | null;
  /**
   * Every recorded Take's own analysis, in recording order, for a multi-Take
   * loopback run (`LoopbackSummary.trackCount` above 1). `loopbackAnalysis`
   * alone only ever shows the *last* Take (the overdub of interest), so a
   * reader who needs the earlier, solo Take(s) for comparison — e.g. "is
   * only the overdub truncated, or the solo Take too?" — needs this array.
   * Absent/null for anything but a multi-Take loopback run.
   */
  loopbackAnalyses?: LoopbackAnalysisResult[] | null;
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
