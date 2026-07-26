import { describe, it, expect } from "vitest";
import { analyseErrors } from "./errorAnalysis";

const EXPECTED = [0, 600, 1200, 1800, 2400];

describe("analyseErrors", () => {
  it("reports zero error for onsets that land exactly on the grid", () => {
    const { perBeat, spuriousOnsetsMs } = analyseErrors(EXPECTED, [...EXPECTED]);
    expect(perBeat.map((b) => b.errorMs)).toEqual([0, 0, 0, 0, 0]);
    expect(spuriousOnsetsMs).toEqual([]);
  });

  it("a uniformly shifted onset set yields equal per-beat errors — constant offset", () => {
    const shifted = EXPECTED.map((t) => t + 25);
    const { perBeat } = analyseErrors(EXPECTED, shifted);
    expect(perBeat.map((b) => b.errorMs)).toEqual([25, 25, 25, 25, 25]);
  });

  it("a progressively shifted onset set yields a monotonic ramp — drift", () => {
    const shifted = EXPECTED.map((t, i) => t + i * 10);
    const { perBeat } = analyseErrors(EXPECTED, shifted);
    const errors = perBeat.map((b) => b.errorMs) as number[];
    expect(errors).toEqual([0, 10, 20, 30, 40]);
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]).toBeGreaterThan(errors[i - 1]);
    }
  });

  it("a randomly perturbed onset set yields neither a constant nor a monotonic shape — jitter", () => {
    const perturbations = [5, -30, 15, -5, 20];
    const shifted = EXPECTED.map((t, i) => t + perturbations[i]);
    const { perBeat } = analyseErrors(EXPECTED, shifted);
    const errors = perBeat.map((b) => b.errorMs) as number[];

    expect(new Set(errors).size).toBeGreaterThan(1);
    let increased = false;
    let decreased = false;
    for (let i = 1; i < errors.length; i++) {
      if (errors[i] > errors[i - 1]) increased = true;
      if (errors[i] < errors[i - 1]) decreased = true;
    }
    expect(increased && decreased).toBe(true);
  });

  it("reports an omitted beat as missing rather than silently skipped", () => {
    const withoutThirdBeat = EXPECTED.filter((_, i) => i !== 2);
    const { perBeat } = analyseErrors(EXPECTED, withoutThirdBeat);

    expect(perBeat[2]).toEqual({ beatIndex: 2, expectedMs: 1200, errorMs: null });
    expect(perBeat.filter((b) => b.errorMs === null)).toHaveLength(1);
  });

  it("reports a doubled transient as spurious rather than a shifted error", () => {
    const doubled = [...EXPECTED, 1230]; // an extra onset near beat 2 (1200)
    const { perBeat, spuriousOnsetsMs } = analyseErrors(EXPECTED, doubled);

    expect(perBeat.every((b) => b.errorMs !== null)).toBe(true);
    expect(perBeat[2].errorMs).toBe(0); // the genuine onset, still claimed correctly
    expect(spuriousOnsetsMs).toEqual([1230]);
  });

  it("never lets two beats claim the same onset", () => {
    // Only one onset, roughly between two expected beats.
    const { perBeat } = analyseErrors([1000, 1010], [1004]);
    const claimedCount = perBeat.filter((b) => b.errorMs !== null).length;
    expect(claimedCount).toBe(1);
  });

  it("leaves an onset far outside tolerance unclaimed as spurious", () => {
    const { perBeat, spuriousOnsetsMs } = analyseErrors(EXPECTED, [...EXPECTED, 100000]);
    expect(perBeat.every((b) => b.errorMs !== null)).toBe(true);
    expect(spuriousOnsetsMs).toEqual([100000]);
  });
});
