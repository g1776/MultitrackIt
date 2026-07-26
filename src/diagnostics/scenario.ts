import type { CountInAdapter, PlaybackAdapter } from "../engine/adapters";
import type { EngineEventSink } from "../engine/events";
import { RecordingEngine } from "../engine/RecordingEngine";
import type { Project } from "../engine/types";
import { SyntheticCaptureAdapter } from "../adapters/syntheticCaptureAdapter";

export interface ScenarioParams {
  trackCount: number;
  tempoBpm: number;
  beatsPerBar: number;
  beatCount: number;
  /**
   * Simulated capture-device acquisition delay (ms), threaded to the
   * `SyntheticCaptureAdapter`'s `arm()`. Zero by default, matching a healthy
   * device post-#24. A synthetic run that always armed instantly would be a
   * fake of an adapter we wish we had rather than a fake of the real one —
   * setting this lets a run still exercise (and regress-test) arming taking
   * real, variable time ahead of the fixed lead-in, without that variance
   * ever landing on the Padding or Count-in.
   */
  armDelayMs: number;
}

/**
 * Three Tracks, 100bpm, 4/4, 16 beats, no simulated arm delay (ADR 0004).
 * 100bpm is deliberate: 600ms between onsets means an onset detector can't
 * plausibly confuse adjacent beats, so an early harness bug presents as an
 * obviously wrong number rather than a subtly wrong one. 16 beats is long
 * enough for drift to accumulate visibly.
 */
export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  trackCount: 3,
  tempoBpm: 100,
  beatsPerBar: 4,
  beatCount: 16,
  armDelayMs: 0,
};

export interface ScenarioProgress {
  /** 0-based index of the Track currently being recorded, or `trackCount` once every Track is done. */
  trackIndex: number;
  trackCount: number;
}

export interface RunSyntheticScenarioOptions {
  /** Real playback adapter — playback stays entirely real throughout a synthetic run (ADR 0004). */
  playback: PlaybackAdapter;
  countIn?: CountInAdapter;
  events?: EngineEventSink;
  params?: Partial<ScenarioParams>;
  onProgress?: (progress: ScenarioProgress) => void;
  /**
   * Overridable for tests. Production always waits real time between capture
   * start and stop — the scenario drives the real record/stop path, so a run
   * inherently takes real time (ADR 0004) — but a test asserting the call
   * sequence has no reason to actually wait.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Lead-in overrides, for tests only; production leaves the engine's own real Padding/Count-in defaults in place. */
  countInBars?: number;
  countInPaddingMs?: number;
  idleReleaseMs?: number;
}

export interface ScenarioResult {
  project: Project;
  params: ScenarioParams;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveParams(overrides: Partial<ScenarioParams> | undefined): ScenarioParams {
  const params = { ...DEFAULT_SCENARIO_PARAMS, ...overrides };
  if (!(params.trackCount > 0)) throw new Error("trackCount must be positive");
  if (!(params.tempoBpm > 0)) throw new Error("tempoBpm must be positive");
  if (!(params.beatsPerBar > 0)) throw new Error("beatsPerBar must be positive");
  if (!(params.beatCount > 0)) throw new Error("beatCount must be positive");
  if (params.armDelayMs < 0) throw new Error("armDelayMs must not be negative");
  return params;
}

/**
 * Runs the default synthetic sync scenario end to end: a fresh Project with
 * `trackCount` Tracks of one Take each, each driven through the real
 * `recordTake`/`stopRecording` path — real arming, real Padding, real
 * Count-in — against a `SyntheticCaptureAdapter` standing in for the
 * microphone and camera (ADR 0004). Only capture differs from a normal
 * recording session; playback stays entirely real throughout, and the engine
 * itself cannot tell a synthetic Take from a real one.
 *
 * Cross-Track sync is the property under test, so this records exactly one
 * Take per Track rather than several — choosing among several Takes on one
 * Track only swaps which Offset enters the schedule and introduces no timing
 * logic (ADR 0004) — and it drives `recordTake`/`stopRecording` rather than
 * appending Takes to Tracks directly, so it exercises the same arithmetic a
 * real recording session does.
 */
export async function runSyntheticScenario(
  options: RunSyntheticScenarioOptions
): Promise<ScenarioResult> {
  const params = resolveParams(options.params);
  const sleep = options.sleep ?? defaultSleep;

  const capture = new SyntheticCaptureAdapter({
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    beatCount: params.beatCount,
    armDelayMs: params.armDelayMs,
  });
  const engine = new RecordingEngine(capture, options.playback, {
    countIn: options.countIn,
    events: options.events,
    countInBars: options.countInBars,
    countInPaddingMs: options.countInPaddingMs,
    idleReleaseMs: options.idleReleaseMs,
  });

  engine.createProject("Synthetic sync scenario", {
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
  });

  const beatIntervalMs = 60000 / params.tempoBpm;
  const performanceMs = params.beatCount * beatIntervalMs;

  for (let trackIndex = 0; trackIndex < params.trackCount; trackIndex++) {
    options.onProgress?.({ trackIndex, trackCount: params.trackCount });
    await engine.recordTake(undefined);
    await sleep(performanceMs);
    await engine.stopRecording();
  }
  options.onProgress?.({ trackIndex: params.trackCount, trackCount: params.trackCount });

  // Set by createProject just above; the loop above cannot have cleared it.
  return { project: engine.getActiveProject() as Project, params };
}
