import { describe, it, expect } from "vitest";
import { downsamplePeaks } from "./waveformReduction";

describe("downsamplePeaks", () => {
  it("is empty for an empty buffer", () => {
    expect(downsamplePeaks(new Float32Array(0), 10)).toEqual([]);
  });

  it("is empty for a non-positive bucket count", () => {
    expect(downsamplePeaks(new Float32Array(100), 0)).toEqual([]);
  });

  it("reduces each bucket to its peak absolute value", () => {
    const samples = Float32Array.from([0.1, -0.9, 0.2, 0.3, -0.4, 0.05]);
    const peaks = downsamplePeaks(samples, 2);
    expect(peaks[0]).toBeCloseTo(0.9, 5);
    expect(peaks[1]).toBeCloseTo(0.4, 5);
  });

  it("carries a negative peak through as a positive magnitude", () => {
    const samples = Float32Array.from([-0.5, 0.1]);
    expect(downsamplePeaks(samples, 1)).toEqual([0.5]);
  });

  it("never returns more buckets than the sample count needs", () => {
    const samples = new Float32Array(10);
    expect(downsamplePeaks(samples, 1000).length).toBeLessThanOrEqual(10);
  });
});
