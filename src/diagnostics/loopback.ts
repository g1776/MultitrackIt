import { decodeMediaRef } from "../adapters/audioDecode";
import { computeSyntheticBeatGrid, renderBeepsAtTimes, SYNTHETIC_SAMPLE_RATE } from "./syntheticSignal";
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

/** A single fixed pitch: unlike Mode B's per-Track pitches, there's only ever one capture here, so nothing needs telling apart. */
const LOOPBACK_PITCH_HZ = 440;

/**
 * Silence recorded past the last expected beat. A real device's round-trip
 * latency is exactly what this mode exists to measure, so the capture window
 * can't end the instant the signal itself stops — that would clip off a slow
 * device's own last onsets and read as "no onset" instead of "slow".
 */
const CAPTURE_TAIL_MS = 1000;

function resolveParams(overrides: Partial<LoopbackParams> | undefined): LoopbackParams {
  const params = { ...DEFAULT_LOOPBACK_PARAMS, ...overrides };
  if (!(params.bpm > 0)) throw new Error("bpm must be positive");
  if (!(params.beatsPerBar > 0)) throw new Error("beatsPerBar must be positive");
  if (!(params.beatCount > 0)) throw new Error("beatCount must be positive");
  return params;
}

/**
 * Opens the microphone, asking for unprocessed audio the same way capture
 * does elsewhere (`openUnprocessedStream`), falling back to the browser's
 * defaults if the device refuses the constrained request outright. Kept
 * separate from `openUnprocessedStream` because that helper always asks for
 * video too — a Track is audio+video coupled (`CONTEXT.md`), but this mode
 * measures a device, not a Track, and has no camera to open.
 */
async function defaultOpenMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
  } catch (error) {
    if ((error as Error)?.name !== "OverconstrainedError") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

/** Records `stream` via `MediaRecorder` for `durationMs`, then resolves a playable media reference. */
function defaultRecordStream(stream: MediaStream, durationMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => reject((event as unknown as { error: Error }).error);
    recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
    recorder.start();
    setTimeout(() => recorder.stop(), durationMs);
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Renders the synthetic beat-grid signal as an `AudioBuffer` ready to play through `audioContext`'s destination. */
function renderLoopbackBuffer(
  audioContext: AudioContext,
  params: LoopbackParams,
  signalDurationMs: number
): AudioBuffer {
  const atMsList = computeSyntheticBeatGrid(params).map((click) => click.atMs);
  const samples = renderBeepsAtTimes(atMsList, LOOPBACK_PITCH_HZ, signalDurationMs);
  const buffer = audioContext.createBuffer(1, samples.length, SYNTHETIC_SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

export interface RunLoopbackScenarioOptions {
  /**
   * Shared with playback — ADR 0004 gives Mode A no reason to open a second
   * clock — the signal is played through this context's own destination
   * (the speakers).
   */
  audioContext: AudioContext;
  params?: Partial<LoopbackParams>;
  /** Opens the microphone stream. Defaults to a real, unprocessed-audio getUserMedia request. Overridable for tests, which have no getUserMedia. */
  openMicStream?: () => Promise<MediaStream>;
  /** Records `stream` for `durationMs`, resolving a playable media reference. Defaults to a real MediaRecorder. Overridable for tests. */
  recordStream?: (stream: MediaStream, durationMs: number) => Promise<string>;
  decode?: typeof decodeMediaRef;
  /** Overridable for tests, which have no reason to actually wait out a real capture window. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LoopbackScenarioResult {
  params: LoopbackSummary;
  analysis: LoopbackAnalysisResult;
}

/**
 * Runs Mode A end to end (ADR 0004): plays the synthetic beat-grid signal
 * through the speakers while simultaneously recording through the
 * microphone, with no human performing, then decodes and analyses the
 * capture into a round-trip latency figure. Requires speakers rather than
 * headphones — the signal has to leave the room and come back in through
 * the mic for a round-trip figure to mean anything; a run over headphones
 * or with muted speakers surfaces as `analysis.noOnsetsDetected`, not a
 * spurious offset.
 *
 * Unlike Mode B, there is no Project, Track, or Take involved: this
 * measures a device against Mode B's already-verified engine, not the
 * engine itself (ADR 0004), so it has no reason to go through
 * `RecordingEngine` at all.
 */
export async function runLoopbackScenario(
  options: RunLoopbackScenarioOptions
): Promise<LoopbackScenarioResult> {
  const params = resolveParams(options.params);
  const openMicStream = options.openMicStream ?? defaultOpenMicStream;
  const recordStream = options.recordStream ?? defaultRecordStream;
  const decode = options.decode ?? decodeMediaRef;
  const sleep = options.sleep ?? defaultSleep;

  const beatIntervalMs = 60000 / params.bpm;
  const signalDurationMs = params.beatCount * beatIntervalMs;
  const captureDurationMs = signalDurationMs + CAPTURE_TAIL_MS;

  const stream = await openMicStream();
  try {
    const source = options.audioContext.createBufferSource();
    source.buffer = renderLoopbackBuffer(options.audioContext, params, signalDurationMs);
    source.connect(options.audioContext.destination);

    const recording = recordStream(stream, captureDurationMs);
    source.start();
    await sleep(captureDurationMs);
    const mediaRef = await recording;

    const decoded = await decode(mediaRef, options.audioContext);
    const expectedBeatTimesMs = computeSyntheticBeatGrid(params).map((click) => click.atMs);

    return { params, analysis: analyseLoopback(decoded, expectedBeatTimesMs) };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
