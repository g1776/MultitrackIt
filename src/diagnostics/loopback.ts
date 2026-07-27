import type { CaptureAdapter, CountInAdapter, PlaybackAdapter } from "../engine/adapters";
import type { EngineEventSink } from "../engine/events";
import { RecordingEngine, type MetronomeAudioSource } from "../engine/RecordingEngine";
import type { Project } from "../engine/types";
import { decodeMediaRef } from "../adapters/audioDecode";
import { analyseLoopback } from "./loopbackAnalysis";
import type { LoopbackAnalysisResult, LoopbackSummary } from "./types";

export interface LoopbackParams {
  bpm: number;
  beatsPerBar: number;
  beatCount: number;
}

/**
 * 100bpm/16 beats matches the synthetic-capture default (ADR 0004's Mode B):
 * a round-trip figure is easiest to compare against Mode B's own numbers
 * when both ran the same beat grid.
 */
export const DEFAULT_LOOPBACK_PARAMS: LoopbackParams = {
  bpm: 100,
  beatsPerBar: 4,
  beatCount: 16,
};

/**
 * Silence recorded past the last expected beat. A real device's round-trip
 * latency is exactly what this mode exists to measure, so the capture window
 * can't end the instant the Guide itself stops — that would clip off a slow
 * device's own last onsets and read as "no onset" instead of "slow".
 */
export const CAPTURE_TAIL_MS = 1000;

function resolveParams(overrides: Partial<LoopbackParams> | undefined): LoopbackParams {
  const params = { ...DEFAULT_LOOPBACK_PARAMS, ...overrides };
  if (!(params.bpm > 0)) throw new Error("bpm must be positive");
  if (!(params.beatsPerBar > 0)) throw new Error("beatsPerBar must be positive");
  if (!(params.beatCount > 0)) throw new Error("beatCount must be positive");
  return params;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunLoopbackScenarioOptions {
  /** Real, audio-only microphone capture adapter — overridable for tests, which have no getUserMedia. */
  capture: CaptureAdapter;
  /** Real playback adapter — the generated Metronome Guide plays through this for real, out the speakers (ADR 0004). */
  playback: PlaybackAdapter;
  /** Metronome audio synthesis, used to generate the ephemeral Project's Guide, same as Mode B. */
  metronomeAudio: MetronomeAudioSource;
  countIn?: CountInAdapter;
  events?: EngineEventSink;
  params?: Partial<LoopbackParams>;
  /** Decodes the recorded Take's media into samples ready to analyse. Defaults to the real `decodeMediaRef`. Overridable for tests. */
  decode?: typeof decodeMediaRef;
  audioContext: AudioContext;
  /** Overridable for tests, which have no reason to actually wait out a real capture window. */
  sleep?: (ms: number) => Promise<void>;
  /** Lead-in overrides, for tests only; production leaves the engine's own real Padding/Count-in defaults in place. */
  countInBars?: number;
  countInPaddingMs?: number;
  idleReleaseMs?: number;
}

export interface LoopbackScenarioResult {
  project: Project;
  params: LoopbackSummary;
  analysis: LoopbackAnalysisResult;
}

/**
 * Runs Mode A end to end (ADR 0004, ADR 0006): a fresh ephemeral Project with
 * a generated Metronome Guide, recorded through the real
 * `recordTake`/`stopRecording` path — real arming, real Padding, real
 * Count-in — against a real microphone `CaptureAdapter`, exactly as Mode B
 * records against its `SyntheticCaptureAdapter`. Playback stays entirely
 * real throughout: the Guide plays out the speakers while the microphone
 * captures it back, with no human performing.
 *
 * Requires speakers rather than headphones — the signal has to leave the
 * room and come back in through the mic for a round-trip figure to mean
 * anything; a run over headphones or with muted speakers surfaces as
 * `analysis.noOnsetsDetected`, not a spurious offset.
 *
 * This deliberately measures more than Mode A used to: device round-trip on
 * top of engine scheduling, not the device alone. That widening is safe
 * because Mode A only ever runs after a passing Mode B validation (ADR 0006).
 */
export async function runLoopbackScenario(
  options: RunLoopbackScenarioOptions
): Promise<LoopbackScenarioResult> {
  const params = resolveParams(options.params);
  const decode = options.decode ?? decodeMediaRef;
  const sleep = options.sleep ?? defaultSleep;

  const engine = new RecordingEngine(options.capture, options.playback, {
    countIn: options.countIn,
    events: options.events,
    countInBars: options.countInBars,
    countInPaddingMs: options.countInPaddingMs,
    idleReleaseMs: options.idleReleaseMs,
    metronomeAudio: options.metronomeAudio,
  });

  engine.createProject("Acoustic loopback", { bpm: params.bpm, beatsPerBar: params.beatsPerBar });

  const beatIntervalMs = 60000 / params.bpm;
  const signalDurationMs = params.beatCount * beatIntervalMs;
  const captureDurationMs = signalDurationMs + CAPTURE_TAIL_MS;

  // A real Guide, long enough to cover the whole beat grid (ADR 0006), played
  // back through Monitor Mix during the Take exactly as Mode B does. Only
  // `signalDurationMs` long, not `captureDurationMs`: `CAPTURE_TAIL_MS` is
  // silence recorded past the last beat to catch a slow device's late onset,
  // not more Guide for it to play.
  engine.generateMetronomeGuide({ durationMs: signalDurationMs });

  await engine.recordTake(undefined);
  await sleep(captureDurationMs);
  await engine.stopRecording();

  const project = engine.getActiveProject() as Project;
  // stopRecording() always pushes exactly one Take onto the fresh Track
  // recordTake() just created, so this is always present.
  const take = project.tracks[0].takes[0];
  const decoded = await decode(take.mediaRef, options.audioContext);

  // Sourced from the real Guide's own schedule rather than computed
  // independently (ADR 0006), so the expectation can never disagree with
  // what was actually scheduled and played.
  const schedule = project.guide?.metronomeSchedule;
  if (!schedule) throw new Error("Loopback Project has no Metronome Guide schedule to analyse against");
  const expectedBeatTimesMs = schedule.slice(0, params.beatCount).map((click) => click.atMs);

  return { project, params, analysis: analyseLoopback(decoded, expectedBeatTimesMs) };
}
