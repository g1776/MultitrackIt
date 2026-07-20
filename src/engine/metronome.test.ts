import { describe, it, expect } from "vitest";
import { computeMetronomeClicks } from "./metronome";

describe("computeMetronomeClicks", () => {
  it("places one click per beat at the interval implied by bpm", () => {
    const clicks = computeMetronomeClicks({ bpm: 120, beatsPerBar: 4, durationMs: 2000 });
    expect(clicks.map((c) => c.atMs)).toEqual([0, 500, 1000, 1500]);
  });

  it("accents the first beat of each bar and no others", () => {
    const clicks = computeMetronomeClicks({ bpm: 120, beatsPerBar: 4, durationMs: 2000 });
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it("accents every bar's downbeat across multiple bars", () => {
    const clicks = computeMetronomeClicks({ bpm: 60, beatsPerBar: 2, durationMs: 4000 });
    expect(clicks.map((c) => c.accent)).toEqual([true, false, true, false]);
  });

  it("returns no clicks for a non-positive duration", () => {
    expect(computeMetronomeClicks({ bpm: 120, beatsPerBar: 4, durationMs: 0 })).toEqual([]);
  });

  it("throws for a non-positive bpm", () => {
    expect(() => computeMetronomeClicks({ bpm: 0, beatsPerBar: 4, durationMs: 1000 })).toThrow();
  });

  it("throws for a non-positive beatsPerBar", () => {
    expect(() => computeMetronomeClicks({ bpm: 120, beatsPerBar: 0, durationMs: 1000 })).toThrow();
  });

  it("supports a beatsPerBar of 1 (every beat accented)", () => {
    const clicks = computeMetronomeClicks({ bpm: 120, beatsPerBar: 1, durationMs: 1000 });
    expect(clicks.every((c) => c.accent)).toBe(true);
  });
});
