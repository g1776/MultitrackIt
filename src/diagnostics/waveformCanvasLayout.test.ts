import { describe, expect, it } from "vitest";
import { computeWaveformCanvasLayout } from "./waveformCanvasLayout";
import type { AnalysisResult, TrackAnalysis } from "./types";

function track(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    trackId: "t1",
    label: "Track 1",
    sampleRate: 48000,
    durationMs: 1000,
    expectedBeatTimesMs: [0, 500],
    detectedOnsetsMs: [0, 500],
    perBeatErrorMs: [0, 0],
    missingBeatIndices: [],
    spuriousOnsetsMs: [],
    peaks: [0.5, 1],
    ...overrides,
  };
}

describe("computeWaveformCanvasLayout", () => {
  it("returns empty layout for no Tracks", () => {
    const analysis: AnalysisResult = { simulatedLatencyMs: 0, tracks: [] };
    const layout = computeWaveformCanvasLayout(analysis, 400, 200);
    expect(layout.rows).toEqual([]);
    expect(layout.gridlineXs).toEqual([]);
    expect(layout.durationMs).toBe(0);
  });

  it("stacks each Track into its own equal-height row", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 0,
      tracks: [track({ trackId: "a" }), track({ trackId: "b" }), track({ trackId: "c" })],
    };
    const layout = computeWaveformCanvasLayout(analysis, 300, 300);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.map((r) => r.rowHeight)).toEqual([100, 100, 100]);
    expect(layout.rows.map((r) => r.centerY)).toEqual([50, 150, 250]);
  });

  it("places gridlines from the shared expected beat grid, spanning full width at full duration", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 0,
      tracks: [track({ expectedBeatTimesMs: [0, 250, 500, 750] })],
    };
    const layout = computeWaveformCanvasLayout(analysis, 800, 100);
    expect(layout.gridlineXs).toEqual([0, 200, 400, 600]);
  });

  it("places peak bars on the shared time axis, scaled by amplitude within the row", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 0,
      tracks: [track({ durationMs: 1000, peaks: [0.5, 1] })],
    };
    const layout = computeWaveformCanvasLayout(analysis, 1000, 100);
    const [row] = layout.rows;
    // 2 buckets over 1000ms -> bucket centers/starts at t=0 and t=500 -> x=0, x=500
    expect(row.bars[0].x).toBe(0);
    expect(row.bars[1].x).toBe(500);
    // rowHeight=100, half=50, minus padding 4 => 46. peak 1.0 -> halfHeight 46
    expect(row.bars[1].halfHeight).toBeCloseTo(46);
    expect(row.bars[0].halfHeight).toBeCloseTo(23);
  });

  it("places onset marks on the shared time axis so drift against gridlines is visible", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 0,
      tracks: [
        track({ durationMs: 1000, expectedBeatTimesMs: [0, 500], detectedOnsetsMs: [50, 520] }),
      ],
    };
    const layout = computeWaveformCanvasLayout(analysis, 1000, 100);
    expect(layout.rows[0].onsets.map((o) => o.x)).toEqual([50, 520]);
    expect(layout.gridlineXs).toEqual([0, 500]);
  });

  it("uses the longest Track's duration and the beat grid's extent as the shared time axis", () => {
    const analysis: AnalysisResult = {
      simulatedLatencyMs: 0,
      tracks: [
        track({ trackId: "short", durationMs: 800, expectedBeatTimesMs: [0, 400] }),
        track({ trackId: "long", durationMs: 1000, expectedBeatTimesMs: [0, 400] }),
      ],
    };
    const layout = computeWaveformCanvasLayout(analysis, 1000, 100);
    expect(layout.durationMs).toBe(1000);
  });
});
