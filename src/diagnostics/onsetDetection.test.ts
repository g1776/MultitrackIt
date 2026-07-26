import { describe, it, expect } from "vitest";
import { detectOnsets } from "./onsetDetection";
import { renderBeepsAtTimes, SYNTHETIC_SAMPLE_RATE } from "./syntheticSignal";

describe("detectOnsets", () => {
  it("finds nothing in silence", () => {
    const samples = new Float32Array(SYNTHETIC_SAMPLE_RATE);
    expect(detectOnsets(samples, SYNTHETIC_SAMPLE_RATE)).toEqual([]);
  });

  it("recovers known onset positions within a few ms", () => {
    const atMsList = [0, 300, 600, 900];
    const samples = renderBeepsAtTimes(atMsList, 440, 1200);
    const detected = detectOnsets(samples, SYNTHETIC_SAMPLE_RATE);

    expect(detected).toHaveLength(atMsList.length);
    detected.forEach((onsetMs, i) => {
      expect(Math.abs(onsetMs - atMsList[i])).toBeLessThan(10);
    });
  });

  it("reports one onset per beep rather than chattering across a beep's decay", () => {
    const samples = renderBeepsAtTimes([500], 440, 1000);
    expect(detectOnsets(samples, SYNTHETIC_SAMPLE_RATE)).toHaveLength(1);
  });

  it("reports two onsets for a doubled transient with a real gap between them", () => {
    const samples = renderBeepsAtTimes([500, 560], 440, 1000);
    expect(detectOnsets(samples, SYNTHETIC_SAMPLE_RATE)).toHaveLength(2);
  });
});
