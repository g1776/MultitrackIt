import { describe, it, expect, vi } from "vitest";
import { FakeCountInAdapter, FakePlaybackAdapter } from "../engine/fakeAdapters";
import { createFakeEventSink } from "./fakeEventSink";
import {
  DEFAULT_SCENARIO_PARAMS,
  runSyntheticScenario,
  type RunSyntheticScenarioOptions,
} from "./scenario";

/** Skips the real lead-in and the real performance wait so tests run instantly. */
const FAST: Partial<RunSyntheticScenarioOptions> = {
  countInBars: 0,
  countInPaddingMs: 0,
  idleReleaseMs: 0,
  sleep: async () => {},
};

function run(overrides: Partial<RunSyntheticScenarioOptions> = {}) {
  return runSyntheticScenario({
    playback: new FakePlaybackAdapter(),
    countIn: new FakeCountInAdapter(),
    ...FAST,
    ...overrides,
  });
}

describe("runSyntheticScenario", () => {
  it("creates a Project at the default tempo and time signature", async () => {
    const { project, params } = await run();
    expect(project.tempoBpm).toBe(DEFAULT_SCENARIO_PARAMS.tempoBpm);
    expect(project.beatsPerBar).toBe(DEFAULT_SCENARIO_PARAMS.beatsPerBar);
    expect(params).toEqual(DEFAULT_SCENARIO_PARAMS);
  });

  it("records the default 3 Tracks of one Take each", async () => {
    const { project } = await run();
    expect(project.tracks).toHaveLength(3);
    for (const track of project.tracks) {
      expect(track.takes).toHaveLength(1);
    }
  });

  it("respects a configured Track count, tempo, and beat count", async () => {
    const { project, params } = await run({
      params: { trackCount: 2, tempoBpm: 120, beatCount: 8 },
    });
    expect(project.tracks).toHaveLength(2);
    expect(project.tempoBpm).toBe(120);
    expect(params).toEqual({
      trackCount: 2,
      tempoBpm: 120,
      beatsPerBar: 4,
      beatCount: 8,
      armDelayMs: 0,
    });
  });

  it("gives each Track's Take a distinct mediaRef, since each Track gets a distinct synthetic pitch", async () => {
    const { project } = await run();
    const mediaRefs = project.tracks.map((t) => t.takes[0].mediaRef);
    expect(new Set(mediaRefs).size).toBe(mediaRefs.length);
  });

  it("reports progress once per Track plus a final completion callback", async () => {
    const onProgress = vi.fn();
    await run({ onProgress, params: { trackCount: 3 } });

    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([
      { trackIndex: 0, trackCount: 3 },
      { trackIndex: 1, trackCount: 3 },
      { trackIndex: 2, trackCount: 3 },
      { trackIndex: 3, trackCount: 3 },
    ]);
  });

  it("drives the real recordTake/stopRecording path, emitting lifecycle events for every pass", async () => {
    const events = createFakeEventSink();
    await run({ events, params: { trackCount: 2 } });

    const types = events.getEvents().map((e) => e.type);
    expect(types.filter((t) => t === "padding-started")).toHaveLength(2);
    expect(types.filter((t) => t === "count-in-started")).toHaveLength(2);
    expect(types.filter((t) => t === "capture-started")).toHaveLength(2);
    expect(types.filter((t) => t === "capture-stopped")).toHaveLength(2);
  });

  it("waits real time between capture start and stop, proportional to the performance length", async () => {
    const sleep = vi.fn(async () => {});
    await run({ sleep, params: { trackCount: 1, tempoBpm: 100, beatCount: 16 } });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(16 * (60000 / 100));
  });

  it.each([
    { trackCount: 0 },
    { tempoBpm: 0 },
    { beatsPerBar: 0 },
    { beatCount: 0 },
    { armDelayMs: -1 },
  ])("rejects an invalid scenario configuration %o", async (overrides) => {
    await expect(run({ params: overrides })).rejects.toThrow();
  });

  it("still completes, and reports the value used, when a non-zero arm delay is simulated", async () => {
    const { params } = await run({ params: { trackCount: 1, armDelayMs: 15 } });
    expect(params.armDelayMs).toBe(15);
  });
});
