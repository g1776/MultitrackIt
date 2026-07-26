import { describe, it, expect } from "vitest";
import { analyseTrack, analyseScenario, type DecodedTrack } from "./analysis";
import {
  computeSyntheticBeatGrid,
  pitchHzForIndex,
  renderBeepsAtTimes,
  renderSyntheticTake,
  SYNTHETIC_SAMPLE_RATE,
} from "./syntheticSignal";

const PARAMS = { bpm: 100, beatsPerBar: 4, beatCount: 16 };
const BEAT_INTERVAL_MS = 60000 / PARAMS.bpm;
const TOTAL_DURATION_MS = PARAMS.beatCount * BEAT_INTERVAL_MS;

function expectedBeatTimesMs(): number[] {
  return computeSyntheticBeatGrid(PARAMS).map((c) => c.atMs);
}

function decodedTrack(atMsList: number[]): DecodedTrack {
  return {
    trackId: "track-1",
    label: "Track 1",
    samples: renderBeepsAtTimes(atMsList, pitchHzForIndex(0), TOTAL_DURATION_MS),
    sampleRate: SYNTHETIC_SAMPLE_RATE,
  };
}

/** Small seeded PRNG so the "jitter" case is deterministic across runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("analyseTrack", () => {
  it("reports near-zero error for a perfectly performed Take", () => {
    const analysis = analyseTrack(decodedTrack(expectedBeatTimesMs()), expectedBeatTimesMs());

    expect(analysis.missingBeatIndices).toEqual([]);
    expect(analysis.spuriousOnsetsMs).toEqual([]);
    for (const error of analysis.perBeatErrorMs) {
      expect(error).not.toBeNull();
      expect(Math.abs(error as number)).toBeLessThan(10);
    }
  });

  it("a uniformly shifted onset set yields equal per-beat errors — constant offset", () => {
    const shifted = expectedBeatTimesMs().map((t) => t + 40);
    const analysis = analyseTrack(decodedTrack(shifted), expectedBeatTimesMs());
    const errors = analysis.perBeatErrorMs as number[];

    expect(errors.every((e) => e !== null)).toBe(true);
    expect(Math.max(...errors) - Math.min(...errors)).toBeLessThan(10);
    expect(errors[0]).toBeGreaterThan(30);
  });

  it("a progressively shifted onset set yields a monotonic ramp — drift", () => {
    const shifted = expectedBeatTimesMs().map((t, i) => t + i * 6);
    const analysis = analyseTrack(decodedTrack(shifted), expectedBeatTimesMs());
    const errors = analysis.perBeatErrorMs as number[];

    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]).toBeGreaterThan(errors[i - 1] - 3);
    }
    expect(errors.at(-1)! - errors[0]).toBeGreaterThan(50);
  });

  it("a randomly perturbed onset set yields neither a constant nor a monotonic shape — jitter", () => {
    const rng = mulberry32(42);
    const shifted = expectedBeatTimesMs().map((t) => t + (rng() - 0.5) * 100);
    const analysis = analyseTrack(decodedTrack(shifted), expectedBeatTimesMs());
    const errors = analysis.perBeatErrorMs as number[];

    expect(Math.max(...errors) - Math.min(...errors)).toBeGreaterThan(30);
    let increased = false;
    let decreased = false;
    for (let i = 1; i < errors.length; i++) {
      if (errors[i] > errors[i - 1]) increased = true;
      if (errors[i] < errors[i - 1]) decreased = true;
    }
    expect(increased && decreased).toBe(true);
  });

  it("reports an omitted beat as missing rather than silently skipped", () => {
    const withoutBeat5 = expectedBeatTimesMs().filter((_, i) => i !== 5);
    const analysis = analyseTrack(decodedTrack(withoutBeat5), expectedBeatTimesMs());

    expect(analysis.missingBeatIndices).toEqual([5]);
    expect(analysis.perBeatErrorMs[5]).toBeNull();
  });

  it("reports a doubled transient as spurious rather than a shifted error", () => {
    const withDouble = [...expectedBeatTimesMs(), expectedBeatTimesMs()[3] + 80];
    const analysis = analyseTrack(decodedTrack(withDouble), expectedBeatTimesMs());

    expect(analysis.missingBeatIndices).toEqual([]);
    expect(analysis.spuriousOnsetsMs).toHaveLength(1);
    expect(analysis.perBeatErrorMs[3]).not.toBeNull();
    expect(Math.abs(analysis.perBeatErrorMs[3] as number)).toBeLessThan(10);
  });

  it("carries a peak array and duration alongside the per-beat result", () => {
    const analysis = analyseTrack(decodedTrack(expectedBeatTimesMs()), expectedBeatTimesMs());

    expect(analysis.peaks.length).toBeGreaterThan(0);
    expect(analysis.durationMs).toBeCloseTo(TOTAL_DURATION_MS, 0);
  });
});

describe("analyseScenario", () => {
  it("analyses each Track independently, so one Track's problem can't contaminate another's measurement", () => {
    const good = renderSyntheticTake(PARAMS, pitchHzForIndex(0));
    const bad = decodedTrack(expectedBeatTimesMs().map((t) => t + 200)).samples;

    const result = analyseScenario(
      [
        { trackId: "track-1", label: "Track 1", samples: good, sampleRate: SYNTHETIC_SAMPLE_RATE },
        { trackId: "track-2", label: "Track 2", samples: bad, sampleRate: SYNTHETIC_SAMPLE_RATE },
      ],
      expectedBeatTimesMs(),
      0
    );

    expect(result.tracks).toHaveLength(2);
    const [track1, track2] = result.tracks;
    expect(Math.abs(track1.perBeatErrorMs[0] as number)).toBeLessThan(10);
    expect(track2.perBeatErrorMs[0]).toBeGreaterThan(150);
  });

  it("records the simulated latency the run was made with, so a calibration run can't be mistaken for a real measurement", () => {
    const result = analyseScenario(
      [decodedTrack(expectedBeatTimesMs())],
      expectedBeatTimesMs(),
      50
    );
    expect(result.simulatedLatencyMs).toBe(50);
  });

  it("injecting a known simulated latency produces per-beat errors of approximately that value", () => {
    const shifted = expectedBeatTimesMs().map((t) => t + 50);
    const result = analyseScenario([decodedTrack(shifted)], expectedBeatTimesMs(), 50);

    for (const error of result.tracks[0].perBeatErrorMs) {
      expect(error).not.toBeNull();
      expect(Math.abs((error as number) - 50)).toBeLessThan(10);
    }
  });
});
