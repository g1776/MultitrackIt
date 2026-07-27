import type { AnalysisResult, CalibrationSummary } from "./types";

/**
 * Simulated capture-device latency (ms) a calibration pass injects, matching
 * today's calibration convention (`docs/testing-sync.md`).
 */
export const DEFAULT_CALIBRATION_LATENCY_MS = 80;

/**
 * Max ms a calibration pass's measured error may differ from the latency it
 * injected and still count as validating the harness.
 */
export const DEFAULT_CALIBRATION_TOLERANCE_MS = 20;

/**
 * The mean of every detected per-beat error across every Track in a
 * calibration pass's analysis, or null if nothing was detected. A
 * calibration scenario always runs a single Track (#29), but this reduces
 * across however many are present rather than assuming that shape, so it
 * stays usable if that ever changes.
 */
export function meanMeasuredLatencyMs(analysis: AnalysisResult): number | null {
  const errors = analysis.tracks.flatMap((track) =>
    track.perBeatErrorMs.filter((error): error is number => error !== null)
  );
  if (errors.length === 0) return null;
  return errors.reduce((sum, error) => sum + error, 0) / errors.length;
}

/**
 * Whether a calibration pass's measured error is close enough to the latency
 * it deliberately injected to trust the harness (ADR 0006) — the gate
 * `runFullDiagnosticsSuite` checks before running Mode B or Mode A for real.
 * Pure, and tested on its own at the boundary, independent of how
 * `measuredMs` was produced.
 */
export function checkCalibration(
  injectedLatencyMs: number,
  measuredMs: number | null,
  toleranceMs: number = DEFAULT_CALIBRATION_TOLERANCE_MS
): CalibrationSummary {
  const withinTolerance = measuredMs !== null && Math.abs(measuredMs - injectedLatencyMs) <= toleranceMs;
  return { injectedLatencyMs, measuredMs, withinTolerance };
}
