import { describe, it, expect } from "vitest";
import { computeCountIn } from "./countIn";

describe("computeCountIn", () => {
  it("derives one bar of 4/4 at 100bpm as four beats", () => {
    const plan = computeCountIn({ bpm: 100, beatsPerBar: 4, bars: 1, paddingMs: 1000 });

    expect(plan.countInMs).toBeCloseTo(2400, 6);
    expect(plan.clicks.map((c) => c.atMs)).toEqual([0, 600, 1200, 1800]);
  });

  it("derives the Count-in from the tempo, not a fixed duration", () => {
    const slow = computeCountIn({ bpm: 60, beatsPerBar: 4, bars: 1, paddingMs: 1000 });
    const fast = computeCountIn({ bpm: 180, beatsPerBar: 4, bars: 1, paddingMs: 1000 });

    expect(slow.countInMs).toBeCloseTo(4000, 6);
    expect(fast.countInMs).toBeCloseTo(4 * (60000 / 180), 6);
  });

  it("derives the Count-in from the time signature", () => {
    const threeFour = computeCountIn({ bpm: 120, beatsPerBar: 3, bars: 1, paddingMs: 1000 });
    const sevenEight = computeCountIn({ bpm: 120, beatsPerBar: 7, bars: 1, paddingMs: 1000 });

    expect(threeFour.clicks).toHaveLength(3);
    expect(threeFour.countInMs).toBeCloseTo(1500, 6);
    expect(sevenEight.clicks).toHaveLength(7);
    expect(sevenEight.countInMs).toBeCloseTo(3500, 6);
  });

  it("counts the requested number of bars", () => {
    const plan = computeCountIn({ bpm: 120, beatsPerBar: 4, bars: 2, paddingMs: 1000 });

    expect(plan.clicks).toHaveLength(8);
    expect(plan.countInMs).toBeCloseTo(4000, 6);
  });

  it("accents the first beat of every bar and no other beat", () => {
    const plan = computeCountIn({ bpm: 120, beatsPerBar: 3, bars: 2, paddingMs: 1000 });

    expect(plan.clicks.map((c) => c.accent)).toEqual([true, false, false, true, false, false]);
  });

  it("emits exactly one click per beat at every tempo, with no rounding-induced extra or missing beat", () => {
    for (const bpm of [40, 63, 90, 100, 117, 120, 137, 180, 240]) {
      for (const beatsPerBar of [2, 3, 4, 5, 7]) {
        const plan = computeCountIn({ bpm, beatsPerBar, bars: 1, paddingMs: 1000 });
        expect(plan.clicks).toHaveLength(beatsPerBar);
        expect(plan.clicks[plan.clicks.length - 1].atMs).toBeLessThan(plan.countInMs);
      }
    }
  });

  it("applies the padding at every tempo, including where one bar is longer than the padding", () => {
    const fast = computeCountIn({ bpm: 180, beatsPerBar: 2, bars: 1, paddingMs: 1000 });
    const slow = computeCountIn({ bpm: 50, beatsPerBar: 4, bars: 1, paddingMs: 1000 });

    expect(fast.paddingMs).toBe(1000);
    expect(slow.paddingMs).toBe(1000);
    expect(slow.countInMs).toBeGreaterThan(slow.paddingMs);
  });

  it("reports the total lead-in as padding plus Count-in", () => {
    const plan = computeCountIn({ bpm: 120, beatsPerBar: 4, bars: 1, paddingMs: 1000 });

    expect(plan.leadInMs).toBeCloseTo(3000, 6);
  });

  it("allows a zero-bar Count-in (padding only, no clicks)", () => {
    const plan = computeCountIn({ bpm: 120, beatsPerBar: 4, bars: 0, paddingMs: 1000 });

    expect(plan.clicks).toEqual([]);
    expect(plan.countInMs).toBe(0);
    expect(plan.leadInMs).toBe(1000);
  });

  it("rejects a non-positive tempo or time signature, a negative padding, or a fractional bar count", () => {
    expect(() => computeCountIn({ bpm: 0, beatsPerBar: 4, bars: 1, paddingMs: 0 })).toThrow();
    expect(() => computeCountIn({ bpm: 120, beatsPerBar: 0, bars: 1, paddingMs: 0 })).toThrow();
    expect(() => computeCountIn({ bpm: 120, beatsPerBar: 4, bars: -1, paddingMs: 0 })).toThrow();
    expect(() => computeCountIn({ bpm: 120, beatsPerBar: 4, bars: 1.5, paddingMs: 0 })).toThrow();
    expect(() => computeCountIn({ bpm: 120, beatsPerBar: 4, bars: 1, paddingMs: -1 })).toThrow();
  });
});
