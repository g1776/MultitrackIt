import { detectOnsets, type OnsetDetectionOptions } from "./onsetDetection";
import { analyseErrors } from "./errorAnalysis";
import { downsamplePeaks } from "./waveformReduction";
import type { AnalysisResult, TrackAnalysis } from "./types";

/** One Track's decoded audio, ready to analyse. Decoding itself is a thin browser-API wrapper (ADR 0004) that lives in the adapter layer, not here. */
export interface DecodedTrack {
  trackId: string;
  label: string;
  samples: Float32Array;
  sampleRate: number;
}

/** Peak-array resolution written to a report — coarse enough to stay small, fine enough that a mishandled onset is still visible. */
const PEAK_BUCKET_COUNT = 400;

/**
 * Analyses one Track's audio independently of every other Track (ADR 0004),
 * so one Track's problem can't contaminate another's measurement: detects
 * onsets, pairs them against `expectedBeatTimesMs`, and reduces the same
 * samples to a peak array. Pure — decoding and rendering happen elsewhere.
 */
export function analyseTrack(
  decoded: DecodedTrack,
  expectedBeatTimesMs: number[],
  onsetOptions?: OnsetDetectionOptions
): TrackAnalysis {
  const detectedOnsetsMs = detectOnsets(decoded.samples, decoded.sampleRate, onsetOptions);
  const { perBeat, spuriousOnsetsMs } = analyseErrors(expectedBeatTimesMs, detectedOnsetsMs);

  return {
    trackId: decoded.trackId,
    label: decoded.label,
    sampleRate: decoded.sampleRate,
    durationMs: (decoded.samples.length / decoded.sampleRate) * 1000,
    expectedBeatTimesMs,
    detectedOnsetsMs,
    perBeatErrorMs: perBeat.map((b) => b.errorMs),
    missingBeatIndices: perBeat.filter((b) => b.errorMs === null).map((b) => b.beatIndex),
    spuriousOnsetsMs,
    peaks: downsamplePeaks(decoded.samples, PEAK_BUCKET_COUNT),
  };
}

/**
 * Analyses every Track in a synthetic sync scenario, each independently, and
 * carries the simulated latency the run was made with alongside the result
 * — the single shared object the report is written from, and that a later
 * ticket's on-screen canvas renders from too (ADR 0004).
 */
export function analyseScenario(
  tracks: DecodedTrack[],
  expectedBeatTimesMs: number[],
  simulatedLatencyMs: number,
  onsetOptions?: OnsetDetectionOptions
): AnalysisResult {
  return {
    simulatedLatencyMs,
    tracks: tracks.map((track) => analyseTrack(track, expectedBeatTimesMs, onsetOptions)),
  };
}
