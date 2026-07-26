import { describe, it, expect } from "vitest";
import { analyseLoopback } from "./loopbackAnalysis";
import { renderBeepsAtTimes } from "./syntheticSignal";

const SAMPLE_RATE = 44100;
const EXPECTED_BEAT_TIMES_MS = [0, 600, 1200, 1800];

function captureAt(atMsList: number[], totalDurationMs: number) {
  return {
    samples: renderBeepsAtTimes(atMsList, 440, totalDurationMs),
    sampleRate: SAMPLE_RATE,
  };
}

describe("analyseLoopback", () => {
  it("reports no onsets detected, and a null latency, for silence", () => {
    const capture = { samples: new Float32Array(SAMPLE_RATE * 2), sampleRate: SAMPLE_RATE };
    const result = analyseLoopback(capture, EXPECTED_BEAT_TIMES_MS);

    expect(result.noOnsetsDetected).toBe(true);
    expect(result.roundTripLatencyMs).toBeNull();
    expect(result.track.detectedOnsetsMs).toEqual([]);
    expect(result.track.missingBeatIndices).toEqual([0, 1, 2, 3]);
  });

  it("reports zero round-trip latency for a signal captured exactly on the expected grid", () => {
    const capture = captureAt(EXPECTED_BEAT_TIMES_MS, 2400);
    const result = analyseLoopback(capture, EXPECTED_BEAT_TIMES_MS);

    expect(result.noOnsetsDetected).toBe(false);
    expect(result.roundTripLatencyMs).toBeCloseTo(0, -1);
  });

  it("reports a constant round-trip latency as that shift, even beyond half a beat interval", () => {
    const shiftedMs = EXPECTED_BEAT_TIMES_MS.map((atMs) => atMs + 450);
    const capture = captureAt(shiftedMs, 2400 + 450);
    const result = analyseLoopback(capture, EXPECTED_BEAT_TIMES_MS);

    expect(result.noOnsetsDetected).toBe(false);
    expect(result.roundTripLatencyMs).toBeCloseTo(450, -1);
  });

  it("uses the median matched error, so one spurious detection can't swing the figure", () => {
    const shiftedMs = EXPECTED_BEAT_TIMES_MS.map((atMs) => atMs + 100);
    const capture = captureAt([...shiftedMs, 2350], 2400);
    const result = analyseLoopback(capture, EXPECTED_BEAT_TIMES_MS);

    expect(result.roundTripLatencyMs).toBeCloseTo(100, -1);
    expect(result.track.spuriousOnsetsMs.length).toBeGreaterThan(0);
  });

  it("labels the single Track \"Loopback\"", () => {
    const capture = captureAt(EXPECTED_BEAT_TIMES_MS, 2400);
    const result = analyseLoopback(capture, EXPECTED_BEAT_TIMES_MS);

    expect(result.track.label).toBe("Loopback");
    expect(result.track.trackId).toBe("loopback");
  });
});
