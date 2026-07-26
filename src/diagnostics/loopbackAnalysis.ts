import { detectOnsets, type OnsetDetectionOptions } from "./onsetDetection";
import { analyseErrors } from "./errorAnalysis";
import { downsamplePeaks } from "./waveformReduction";
import type { LoopbackAnalysisResult } from "./types";

/** Peak-array resolution written to a report — matches `analysis.ts`'s Track resolution. */
const PEAK_BUCKET_COUNT = 400;

/** One microphone capture's own decoded audio, ready to analyse. */
export interface DecodedLoopbackCapture {
  samples: Float32Array;
  sampleRate: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Analyses a Mode A acoustic-loopback capture (ADR 0004): the microphone's
 * recording of the synthetic signal played through the speakers, treated as
 * a single Track so it can reuse the same onset detector, error pairing, and
 * waveform canvas as Mode B.
 *
 * Unlike Mode B's cross-Track sync (where a beat can never plausibly be
 * confused with its neighbour, since every Track shares the same clock), a
 * real round trip's latency is unknown ahead of time and can exceed half a
 * beat interval — so matching uses a wider tolerance than
 * `analyseErrors`'s own default, wide enough to still find the beat a
 * late-arriving onset belongs to without crossing into its neighbour.
 *
 * When no onsets are detected at all, this is reported plainly
 * (`noOnsetsDetected: true`, `roundTripLatencyMs: null`) — a probable
 * headphones-or-muted-speakers condition, never a spurious offset.
 */
export function analyseLoopback(
  capture: DecodedLoopbackCapture,
  expectedBeatTimesMs: number[],
  onsetOptions?: OnsetDetectionOptions
): LoopbackAnalysisResult {
  const { samples, sampleRate } = capture;
  const detectedOnsetsMs = detectOnsets(samples, sampleRate, onsetOptions);
  const durationMs = (samples.length / sampleRate) * 1000;
  const peaks = downsamplePeaks(samples, PEAK_BUCKET_COUNT);

  if (detectedOnsetsMs.length === 0) {
    return {
      track: {
        trackId: "loopback",
        label: "Loopback",
        sampleRate,
        durationMs,
        expectedBeatTimesMs,
        detectedOnsetsMs: [],
        perBeatErrorMs: expectedBeatTimesMs.map(() => null),
        missingBeatIndices: expectedBeatTimesMs.map((_, i) => i),
        spuriousOnsetsMs: [],
        peaks,
      },
      roundTripLatencyMs: null,
      noOnsetsDetected: true,
    };
  }

  const beatIntervalMs =
    expectedBeatTimesMs.length >= 2 ? expectedBeatTimesMs[1] - expectedBeatTimesMs[0] : Infinity;
  // A full beat interval, not half: a round-trip latency this harness exists
  // to measure in the first place is exactly the kind of displacement Mode
  // B's tighter tolerance would wrongly reject as a miss.
  const { perBeat, spuriousOnsetsMs } = analyseErrors(expectedBeatTimesMs, detectedOnsetsMs, {
    matchToleranceMs: beatIntervalMs,
  });

  const matchedErrorsMs = perBeat
    .map((beat) => beat.errorMs)
    .filter((errorMs): errorMs is number => errorMs !== null);

  return {
    track: {
      trackId: "loopback",
      label: "Loopback",
      sampleRate,
      durationMs,
      expectedBeatTimesMs,
      detectedOnsetsMs,
      perBeatErrorMs: perBeat.map((beat) => beat.errorMs),
      missingBeatIndices: perBeat.filter((beat) => beat.errorMs === null).map((beat) => beat.beatIndex),
      spuriousOnsetsMs,
      peaks,
    },
    // The median, not the mean: a stray double-trigger or one spurious
    // detection shouldn't be able to swing a single round-trip figure the
    // way it could an average.
    roundTripLatencyMs: median(matchedErrorsMs),
    noOnsetsDetected: false,
  };
}
