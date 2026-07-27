import { describe, it, expect } from "vitest";
import { checkCalibration, meanMeasuredLatencyMs } from "./calibration";
import type { AnalysisResult, TrackAnalysis } from "./types";

function track(perBeatErrorMs: (number | null)[]): TrackAnalysis {
  return {
    trackId: "track-1",
    label: "Track 1",
    sampleRate: 48000,
    durationMs: 1000,
    expectedBeatTimesMs: perBeatErrorMs.map((_, i) => i * 100),
    detectedOnsetsMs: [],
    perBeatErrorMs,
    missingBeatIndices: [],
    spuriousOnsetsMs: [],
    peaks: [],
  };
}

describe("meanMeasuredLatencyMs", () => {
  it("averages every detected per-beat error across every Track", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 80,
      tracks: [track([80, 82, 78])],
    };
    expect(meanMeasuredLatencyMs(analysis)).toBe(80);
  });

  it("ignores missing beats rather than treating them as zero error", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 80,
      tracks: [track([80, null, 80])],
    };
    expect(meanMeasuredLatencyMs(analysis)).toBe(80);
  });

  it("pools errors across multiple Tracks", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 80,
      tracks: [track([80]), track([100])],
    };
    expect(meanMeasuredLatencyMs(analysis)).toBe(90);
  });

  it("returns null when no beat was ever detected", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 80,
      tracks: [track([null, null])],
    };
    expect(meanMeasuredLatencyMs(analysis)).toBeNull();
  });
});

describe("checkCalibration", () => {
  it("passes when the measured value equals the injected value", () => {
    expect(checkCalibration(80, 80)).toEqual({
      injectedLatencyMs: 80,
      measuredMs: 80,
      withinTolerance: true,
    });
  });

  it("passes exactly at the tolerance boundary", () => {
    expect(checkCalibration(80, 100, 20).withinTolerance).toBe(true);
    expect(checkCalibration(80, 60, 20).withinTolerance).toBe(true);
  });

  it("fails just past the tolerance boundary", () => {
    expect(checkCalibration(80, 100.1, 20).withinTolerance).toBe(false);
    expect(checkCalibration(80, 59.9, 20).withinTolerance).toBe(false);
  });

  it("fails when nothing was detected, rather than treating null as passing", () => {
    expect(checkCalibration(80, null)).toEqual({
      injectedLatencyMs: 80,
      measuredMs: null,
      withinTolerance: false,
    });
  });

  it("uses the default tolerance when none is given", () => {
    expect(checkCalibration(80, 100).withinTolerance).toBe(true);
    expect(checkCalibration(80, 101).withinTolerance).toBe(false);
  });
});
