import { computeMetronomeClicks, type MetronomeClick } from "../engine/metronome";

/** Sample rate every synthesised Take is rendered at. */
export const SYNTHETIC_SAMPLE_RATE = 44100;

/** Duration (s) of a single fabricated beep. */
const BEEP_DURATION_S = 0.03;

/** Peak amplitude of a fabricated beep. */
const BEEP_PEAK_AMPLITUDE = 0.8;

export interface SyntheticSignalParams {
  bpm: number;
  beatsPerBar: number;
  /** Whole beats to fabricate, from the file's own t=0. */
  beatCount: number;
}

/**
 * The beat grid a perfect synthetic performer would land on, derived from
 * `computeMetronomeClicks` — the same function that generates the metronome
 * Guide — so the fabricated signal and the Guide can never disagree about
 * where a beat falls (ADR 0004). Measured from the file's own start, since a
 * synthetic Take's own t=0 is the Project timeline's zero point and carries
 * no lead-in correction.
 */
export function computeSyntheticBeatGrid(params: SyntheticSignalParams): MetronomeClick[] {
  const { bpm, beatsPerBar, beatCount } = params;
  if (beatCount <= 0) return [];

  const beatIntervalMs = 60000 / bpm;
  const durationMs = beatCount * beatIntervalMs;
  // `computeMetronomeClicks` rounds its beat count up from a duration; slicing
  // back to `beatCount` guards against a click past the last requested beat
  // that floating-point rounding on `durationMs` could otherwise produce.
  return computeMetronomeClicks({ bpm, beatsPerBar, durationMs }).slice(0, beatCount);
}

/**
 * A distinct pitch (Hz) for the `index`-th synthetic Take, ascending by a
 * major third per Take. The pitch carries no measurement duty — it exists
 * only so a human eye or ear can tell Tracks apart (ADR 0004) — so any
 * strictly-increasing, easily-distinguished sequence would do.
 */
export function pitchHzForIndex(index: number): number {
  const A4 = 440;
  return A4 * Math.pow(2, (index * 4) / 12);
}

function renderBeep(channel: Float32Array, atMs: number, frequencyHz: number): void {
  const startSample = Math.round((atMs / 1000) * SYNTHETIC_SAMPLE_RATE);
  const durationSamples = Math.round(BEEP_DURATION_S * SYNTHETIC_SAMPLE_RATE);

  for (let i = 0; i < durationSamples; i++) {
    const sampleIndex = startSample + i;
    if (sampleIndex >= channel.length) break;
    const t = i / SYNTHETIC_SAMPLE_RATE;
    const envelope = 1 - i / durationSamples;
    channel[sampleIndex] += Math.sin(2 * Math.PI * frequencyHz * t) * envelope * BEEP_PEAK_AMPLITUDE;
  }
}

/**
 * Renders one beep per `atMsList` entry, at `pitchHz`, into a buffer covering
 * `totalDurationMs`. The lower-level primitive under `renderSyntheticTake`,
 * exposed separately so a test (or the simulated-latency control) can render
 * beeps at arbitrary times rather than only at a perfect beat grid — the
 * beat grid times remain the *expected* times an analysis compares against
 * regardless of where a signal was actually rendered.
 */
export function renderBeepsAtTimes(
  atMsList: number[],
  pitchHz: number,
  totalDurationMs: number
): Float32Array {
  const totalSamples = Math.ceil((totalDurationMs / 1000) * SYNTHETIC_SAMPLE_RATE);
  const channel = new Float32Array(totalSamples);

  for (const atMs of atMsList) {
    renderBeep(channel, atMs, pitchHz);
  }

  return channel;
}

/**
 * Renders the media a flawless performer would have produced for one Take:
 * one beep per beat at `computeSyntheticBeatGrid`'s times, at `pitchHz`. Pure
 * sample synthesis, decoupled from WAV encoding so the signal itself can be
 * asserted on without decoding a container format.
 *
 * `latencyMs` shifts every rendered beep by a fixed amount, simulating a
 * capture device that delivers the signal late (ADR 0004's
 * `simulatedLatencyMs`). It leaves `computeSyntheticBeatGrid` itself
 * unshifted — that stays the *expected* grid an analysis compares the
 * (deliberately displaced) captured signal against, which is the whole
 * point of the control: a harness that always reports zero error is
 * indistinguishable from a correct one until it can be made to report a
 * known non-zero value.
 */
export function renderSyntheticTake(
  params: SyntheticSignalParams,
  pitchHz: number,
  latencyMs = 0
): Float32Array {
  const beatIntervalMs = 60000 / params.bpm;
  const totalDurationMs = params.beatCount * beatIntervalMs;
  const atMsList = computeSyntheticBeatGrid(params).map((click) => click.atMs + latencyMs);

  return renderBeepsAtTimes(atMsList, pitchHz, totalDurationMs);
}
