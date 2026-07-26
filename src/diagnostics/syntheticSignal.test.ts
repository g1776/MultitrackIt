import { describe, it, expect } from "vitest";
import { computeMetronomeClicks } from "../engine/metronome";
import {
  SYNTHETIC_SAMPLE_RATE,
  computeSyntheticBeatGrid,
  pitchHzForIndex,
  renderSyntheticTake,
} from "./syntheticSignal";

describe("computeSyntheticBeatGrid", () => {
  it("returns exactly beatCount clicks, one per beat", () => {
    const grid = computeSyntheticBeatGrid({ bpm: 100, beatsPerBar: 4, beatCount: 16 });
    expect(grid).toHaveLength(16);
  });

  it("agrees with computeMetronomeClicks about where each beat falls", () => {
    const params = { bpm: 100, beatsPerBar: 4 };
    const grid = computeSyntheticBeatGrid({ ...params, beatCount: 16 });
    const guideClicks = computeMetronomeClicks({ ...params, durationMs: 16 * (60000 / 100) });

    expect(grid).toEqual(guideClicks.slice(0, 16));
  });

  it("accents the first beat of each bar, same as the Guide", () => {
    const grid = computeSyntheticBeatGrid({ bpm: 100, beatsPerBar: 4, beatCount: 8 });
    expect(grid.map((c) => c.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("is empty for a zero beat count", () => {
    expect(computeSyntheticBeatGrid({ bpm: 100, beatsPerBar: 4, beatCount: 0 })).toEqual([]);
  });
});

describe("pitchHzForIndex", () => {
  it("starts at A4 for the first Take", () => {
    expect(pitchHzForIndex(0)).toBe(440);
  });

  it("is strictly increasing and distinct across successive Tracks", () => {
    const pitches = [0, 1, 2, 3].map(pitchHzForIndex);
    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i]).toBeGreaterThan(pitches[i - 1]);
    }
    expect(new Set(pitches).size).toBe(pitches.length);
  });
});

describe("renderSyntheticTake", () => {
  const params = { bpm: 100, beatsPerBar: 4, beatCount: 4 };

  it("renders a buffer covering exactly the requested performance duration", () => {
    const samples = renderSyntheticTake(params, 440);
    const beatIntervalMs = 60000 / params.bpm;
    const expectedSamples = Math.ceil(
      ((params.beatCount * beatIntervalMs) / 1000) * SYNTHETIC_SAMPLE_RATE
    );
    expect(samples.length).toBe(expectedSamples);
  });

  it("has energy at each beat's onset and silence well before the first beat", () => {
    const samples = renderSyntheticTake(params, 440);
    const beatIntervalMs = 60000 / params.bpm;

    for (const click of computeSyntheticBeatGrid(params)) {
      const startSample = Math.round((click.atMs / 1000) * SYNTHETIC_SAMPLE_RATE);
      expect(Math.abs(samples[startSample + 5])).toBeGreaterThan(0);
    }

    // Silence between the end of the first beep and the second beat's onset.
    const midGapSample = Math.round(
      ((beatIntervalMs / 2) / 1000) * SYNTHETIC_SAMPLE_RATE
    );
    expect(samples[midGapSample]).toBe(0);
  });

  it("produces a different waveform for a different pitch", () => {
    const low = renderSyntheticTake(params, 440);
    const high = renderSyntheticTake(params, 880);
    expect(low).not.toEqual(high);
  });
});
