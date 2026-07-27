import type { CaptureAdapter, CountInAdapter, PlaybackAdapter } from "../engine/adapters";
import { RecordingEngine, type MetronomeAudioSource } from "../engine/RecordingEngine";
import type { Guide, Project } from "../engine/types";
import { SyntheticCaptureAdapter } from "../adapters/syntheticCaptureAdapter";
import { decodeMediaRef } from "../adapters/audioDecode";
import { EngineEventLog } from "./eventLog";
import { analyseScenarioResult, type ScenarioParams, type ScenarioResult } from "./scenario";
import { analyseLoopback } from "./loopbackAnalysis";
import { CAPTURE_TAIL_MS } from "./loopback";
import {
  checkCalibration,
  meanMeasuredLatencyMs,
  DEFAULT_CALIBRATION_LATENCY_MS,
  DEFAULT_CALIBRATION_TOLERANCE_MS,
} from "./calibration";
import { buildReport, summariseProject } from "./report";
import type {
  AudioClockSession,
  AudioProcessingState,
  CalibrationSummary,
  DiagnosticsReport,
  DiagnosticsStorageAdapter,
  LoopbackSummary,
  ScenarioSummary,
} from "./types";

export interface FullSuiteParams {
  trackCount: number;
  tempoBpm: number;
  beatsPerBar: number;
  beatCount: number;
}

/** Matches `DEFAULT_SCENARIO_PARAMS`/`DEFAULT_LOOPBACK_PARAMS' shared tempo/grid (ADR 0006's "fixed, sensible" one-click config). */
export const DEFAULT_FULL_SUITE_PARAMS: FullSuiteParams = {
  trackCount: 3,
  tempoBpm: 100,
  beatsPerBar: 4,
  beatCount: 16,
};

function resolveParams(overrides: Partial<FullSuiteParams> | undefined): FullSuiteParams {
  const params = { ...DEFAULT_FULL_SUITE_PARAMS, ...overrides };
  if (!(params.trackCount > 0)) throw new Error("trackCount must be positive");
  if (!(params.tempoBpm > 0)) throw new Error("tempoBpm must be positive");
  if (!(params.beatsPerBar > 0)) throw new Error("beatsPerBar must be positive");
  if (!(params.beatCount > 0)) throw new Error("beatCount must be positive");
  return params;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown when the suite's calibration pass fails tolerance (ADR 0006). The
 * calibration result rides along on the error, so a caller doesn't need a
 * separate channel to learn what was injected vs. measured — the abort
 * happens before Mode B/Mode A run and before any report is written.
 */
export class CalibrationFailedError extends Error {
  constructor(public readonly calibration: CalibrationSummary) {
    super(
      `Calibration failed: injected ${calibration.injectedLatencyMs}ms latency, measured ` +
        (calibration.measuredMs === null ? "no beats detected" : `${calibration.measuredMs.toFixed(1)}ms`)
    );
    this.name = "CalibrationFailedError";
  }
}

export interface RunFullDiagnosticsSuiteOptions {
  /** Real microphone/camera capture adapter, for Mode A. Calibration and Mode B always use their own `SyntheticCaptureAdapter`s. */
  capture: CaptureAdapter;
  /** Real playback adapter — playback stays entirely real throughout every phase (ADR 0004). */
  playback: PlaybackAdapter;
  /** Metronome audio synthesis, used to generate every phase's Guide. */
  metronomeAudio: MetronomeAudioSource;
  countIn?: CountInAdapter;
  audioContext: AudioContext;
  /** Decodes a recorded Take's media into samples ready to analyse. Defaults to the real `decodeMediaRef`. Overridable for tests. */
  decode?: typeof decodeMediaRef;
  storage: DiagnosticsStorageAdapter;
  /**
   * Observes every phase's lifecycle events into one shared timeline, so the
   * unified report's `events`/lead-in measurements cover calibration, Mode B,
   * and Mode A together rather than only the last phase. Defaults to a fresh
   * `EngineEventLog`.
   */
  events?: EngineEventLog;
  audioClock?: AudioClockSession | null;
  audioProcessing?: AudioProcessingState | null;
  params?: Partial<FullSuiteParams>;
  /** Simulated capture-device latency (ms) the calibration pass injects. Defaults to `DEFAULT_CALIBRATION_LATENCY_MS`. */
  calibrationLatencyMs?: number;
  /** Max ms the calibration pass's measured error may differ from what it injected. Defaults to `DEFAULT_CALIBRATION_TOLERANCE_MS`. */
  calibrationToleranceMs?: number;
  /** Overridable for tests; production waits real time between capture start and stop, for every phase. */
  sleep?: (ms: number) => Promise<void>;
  /** ISO 8601 timestamp for the written report. Defaults to `new Date().toISOString()`. Overridable for tests. */
  now?: () => string;
  /** Lead-in overrides, for tests only; production leaves the engine's own real Padding/Count-in defaults in place. */
  countInBars?: number;
  countInPaddingMs?: number;
  idleReleaseMs?: number;
}

export interface RunFullDiagnosticsSuiteResult {
  report: DiagnosticsReport;
  reportPath: string;
}

function toScenarioParams(params: FullSuiteParams, simulatedLatencyMs: number): ScenarioParams {
  return { ...params, armDelayMs: 0, simulatedLatencyMs };
}

/**
 * Runs the full one-click diagnostics suite end to end (ADR 0006): build one
 * Metronome → calibration → gate → Mode B → Mode A → one unified report.
 *
 * The Metronome is generated exactly once, against a dedicated ephemeral
 * Project, before any capture happens. Calibration, Mode B, and Mode A each
 * still need their own `RecordingEngine` — a `CaptureAdapter` is bound at
 * construction, and the three phases need three different ones (calibration
 * and Mode B each a `SyntheticCaptureAdapter`, at a nonzero and a zero
 * simulated latency respectively; Mode A the real one this function was
 * given) — but every one of them attaches
 * (`RecordingEngine.attachGuide`) the same originally-generated Guide rather
 * than generating its own, so all three phases' expected-beat-times can
 * never disagree (ADR 0006).
 *
 * Calibration runs first: one synthetic Take at a deliberately nonzero
 * `simulatedLatencyMs`, checked against that injected value. If the measured
 * error isn't within tolerance, this throws `CalibrationFailedError` before
 * Mode B or Mode A run and before any report is written — a report can never
 * be mistaken for a real measurement made against an uncalibrated harness.
 */
export async function runFullDiagnosticsSuite(
  options: RunFullDiagnosticsSuiteOptions
): Promise<RunFullDiagnosticsSuiteResult> {
  const params = resolveParams(options.params);
  const decode = options.decode ?? decodeMediaRef;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  const calibrationLatencyMs = options.calibrationLatencyMs ?? DEFAULT_CALIBRATION_LATENCY_MS;
  const calibrationToleranceMs = options.calibrationToleranceMs ?? DEFAULT_CALIBRATION_TOLERANCE_MS;
  const events: EngineEventLog = options.events ?? new EngineEventLog(() => performance.now());

  const engineOptions = {
    countIn: options.countIn,
    events,
    countInBars: options.countInBars,
    countInPaddingMs: options.countInPaddingMs,
    idleReleaseMs: options.idleReleaseMs,
    metronomeAudio: options.metronomeAudio,
  };

  const beatIntervalMs = 60000 / params.tempoBpm;
  const performanceMs = params.beatCount * beatIntervalMs;

  // --- One Metronome, generated once, shared by every phase below -------
  const guideEngine = new RecordingEngine(
    new SyntheticCaptureAdapter({ bpm: params.tempoBpm, beatsPerBar: params.beatsPerBar, beatCount: params.beatCount }),
    options.playback,
    engineOptions
  );
  guideEngine.createProject("Full diagnostics suite", { bpm: params.tempoBpm, beatsPerBar: params.beatsPerBar });
  guideEngine.generateMetronomeGuide({ durationMs: performanceMs });
  const sharedGuide = (guideEngine.getActiveProject() as Project).guide as Guide;

  async function recordAgainstSharedGuide(
    capture: CaptureAdapter,
    trackCount: number
  ): Promise<Project> {
    const engine = new RecordingEngine(capture, options.playback, engineOptions);
    engine.createProject("Full diagnostics suite", { bpm: params.tempoBpm, beatsPerBar: params.beatsPerBar });
    engine.attachGuide(sharedGuide);
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
      await engine.recordTake(undefined);
      await sleep(performanceMs);
      await engine.stopRecording();
    }
    return engine.getActiveProject() as Project;
  }

  // --- Calibration --------------------------------------------------------
  const calibrationCapture = new SyntheticCaptureAdapter({
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    beatCount: params.beatCount,
    simulatedLatencyMs: calibrationLatencyMs,
  });
  const calibrationProject = await recordAgainstSharedGuide(calibrationCapture, 1);
  const calibrationResult: ScenarioResult = {
    project: calibrationProject,
    params: toScenarioParams({ ...params, trackCount: 1 }, calibrationLatencyMs),
  };
  const calibrationAnalysis = await analyseScenarioResult(calibrationResult, options.audioContext, decode);
  const calibration = checkCalibration(
    calibrationLatencyMs,
    meanMeasuredLatencyMs(calibrationAnalysis),
    calibrationToleranceMs
  );

  // --- Gate --------------------------------------------------------------
  if (!calibration.withinTolerance) {
    throw new CalibrationFailedError(calibration);
  }

  // --- Mode B: same shared Metronome, zero simulated latency -------------
  const modeBCapture = new SyntheticCaptureAdapter({
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    beatCount: params.beatCount,
    simulatedLatencyMs: 0,
  });
  const modeBProject = await recordAgainstSharedGuide(modeBCapture, params.trackCount);
  const analysis = await analyseScenarioResult(
    { project: modeBProject, params: toScenarioParams(params, 0) },
    options.audioContext,
    decode
  );

  // --- Mode A: same shared Metronome, real capture adapter ---------------
  const modeAEngine = new RecordingEngine(options.capture, options.playback, engineOptions);
  modeAEngine.createProject("Full diagnostics suite", {
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
  });
  modeAEngine.attachGuide(sharedGuide);

  const captureDurationMs = performanceMs + CAPTURE_TAIL_MS;
  await modeAEngine.recordTake(undefined);
  await sleep(captureDurationMs);
  await modeAEngine.stopRecording();

  const modeAProject = modeAEngine.getActiveProject() as Project;
  // stopRecording() always pushes exactly one Take onto the fresh Track
  // recordTake() just created, so this is always present.
  const loopbackTake = modeAProject.tracks[0].takes[0];
  const decodedLoopback = await decode(loopbackTake.mediaRef, options.audioContext);

  const schedule = sharedGuide.metronomeSchedule;
  if (!schedule) throw new Error("Shared Metronome Guide has no click schedule to analyse against");
  const expectedBeatTimesMs = schedule.slice(0, params.beatCount).map((click) => click.atMs);
  const loopbackAnalysis = analyseLoopback(decodedLoopback, expectedBeatTimesMs);

  // --- Unified report ------------------------------------------------
  const scenarioSummary: ScenarioSummary = {
    trackCount: params.trackCount,
    tempoBpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    beatCount: params.beatCount,
    armDelayMs: 0,
    simulatedLatencyMs: 0,
  };
  const loopbackSummary: LoopbackSummary = {
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    beatCount: params.beatCount,
  };

  const report = buildReport(events.getEvents(), {
    createdAt: now(),
    project: summariseProject(modeAProject),
    audioClock: options.audioClock ?? null,
    audioProcessing: options.audioProcessing ?? null,
    calibration,
    scenario: scenarioSummary,
    analysis,
    loopback: loopbackSummary,
    loopbackAnalysis,
  });

  const reportPath = await options.storage.writeReport(report);
  return { report, reportPath };
}
