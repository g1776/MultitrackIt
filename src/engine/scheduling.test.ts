import { describe, it, expect } from "vitest";
import {
  computePlaybackSchedule,
  selectAudibleTracks,
  buildMonitorMixSchedule,
  buildCompositeSchedule,
  computeGridLayout,
} from "./scheduling";
import type { Track } from "./types";

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    name: overrides.name ?? overrides.id,
    takes: overrides.takes ?? [],
    selectedTakeId: overrides.selectedTakeId ?? null,
    mute: overrides.mute ?? false,
    solo: overrides.solo ?? false,
    ...overrides,
  };
}

describe("computePlaybackSchedule", () => {
  it("returns an empty schedule for no inputs", () => {
    expect(computePlaybackSchedule([])).toEqual({ entries: [] });
  });

  it("uses offsets directly as startAtMs when all offsets are non-negative", () => {
    const schedule = computePlaybackSchedule([
      { takeId: "t1", mediaRef: "m1", offsetMs: 0, volume: 1, muted: false },
      { takeId: "t2", mediaRef: "m2", offsetMs: 250, volume: 1, muted: false },
    ]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([0, 250]);
  });

  it("normalizes negative offsets so the earliest Take starts at 0, preserving relative timing", () => {
    const schedule = computePlaybackSchedule([
      { takeId: "t1", mediaRef: "m1", offsetMs: -200, volume: 1, muted: false },
      { takeId: "t2", mediaRef: "m2", offsetMs: 0, volume: 1, muted: false },
      { takeId: "t3", mediaRef: "m3", offsetMs: 100, volume: 1, muted: false },
    ]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([0, 200, 300]);
  });

  it("keeps all Takes starting together when all offsets are equal (including all-zero)", () => {
    const schedule = computePlaybackSchedule([
      { takeId: "t1", mediaRef: "m1", offsetMs: 0, volume: 1, muted: false },
      { takeId: "t2", mediaRef: "m2", offsetMs: 0, volume: 1, muted: false },
    ]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([0, 0]);
  });

  it("normalizes a single negative-offset Take to start at 0", () => {
    const schedule = computePlaybackSchedule([
      { takeId: "t1", mediaRef: "m1", offsetMs: -500, volume: 1, muted: false },
    ]);
    expect(schedule.entries[0].startAtMs).toBe(0);
  });

  it("preserves volume, muted, and takeId/mediaRef on each entry", () => {
    const schedule = computePlaybackSchedule([
      { takeId: "t1", mediaRef: "m1", offsetMs: 0, volume: 0.5, muted: true },
    ]);
    expect(schedule.entries[0]).toEqual({
      takeId: "t1",
      mediaRef: "m1",
      startAtMs: 0,
      volume: 0.5,
      muted: true,
    });
  });
});

describe("selectAudibleTracks", () => {
  it("returns all Tracks when none are soloed", () => {
    const tracks = [
      makeTrack({ id: "a", selectedTakeId: "t1" }),
      makeTrack({ id: "b", selectedTakeId: "t2" }),
    ];
    expect(selectAudibleTracks(tracks).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("returns only soloed Tracks when at least one Track is soloed", () => {
    const tracks = [
      makeTrack({ id: "a", solo: true, selectedTakeId: "t1" }),
      makeTrack({ id: "b", selectedTakeId: "t2" }),
    ];
    expect(selectAudibleTracks(tracks).map((t) => t.id)).toEqual(["a"]);
  });

  it("excludes muted Tracks and Tracks with no selected Take", () => {
    const tracks = [
      makeTrack({ id: "a", mute: true, selectedTakeId: "take-a" }),
      makeTrack({ id: "b", selectedTakeId: null }),
      makeTrack({ id: "c", selectedTakeId: "take-c" }),
    ];
    expect(selectAudibleTracks(tracks).map((t) => t.id)).toEqual(["c"]);
  });

  it("returns an empty list for an empty Track list", () => {
    expect(selectAudibleTracks([])).toEqual([]);
  });
});

describe("buildMonitorMixSchedule", () => {
  const take = (id: string, trackId: string, offsetMs: number) => ({
    id,
    trackId,
    mediaRef: `media-${id}`,
    offsetMs,
    createdAt: 0,
  });

  it("schedules previously recorded Tracks' selected Takes, offset-corrected, excluding the Track being recorded", () => {
    const trackA = makeTrack({
      id: "a",
      takes: [take("take-a", "a", -100)],
      selectedTakeId: "take-a",
    });
    const trackB = makeTrack({
      id: "b",
      takes: [take("take-b", "b", 0)],
      selectedTakeId: "take-b",
    });
    const recordingTrack = makeTrack({ id: "c" });

    const schedule = buildMonitorMixSchedule(
      [trackA, trackB, recordingTrack],
      new Map(),
      "c"
    );

    expect(schedule.entries.map((e) => e.takeId)).toEqual(["take-a", "take-b"]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([0, 100]);
  });

  it("applies per-Track Monitor Mix levels as volume", () => {
    const trackA = makeTrack({
      id: "a",
      takes: [take("take-a", "a", 0)],
      selectedTakeId: "take-a",
    });
    const schedule = buildMonitorMixSchedule(
      [trackA],
      new Map([["a", 0.3]]),
      undefined
    );
    expect(schedule.entries[0].volume).toBe(0.3);
  });

  it("returns an empty schedule when there are no other recorded Tracks", () => {
    const recordingTrack = makeTrack({ id: "c" });
    const schedule = buildMonitorMixSchedule([recordingTrack], new Map(), "c");
    expect(schedule.entries).toEqual([]);
  });
});

describe("buildCompositeSchedule", () => {
  const take = (id: string, trackId: string, offsetMs: number) => ({
    id,
    trackId,
    mediaRef: `media-${id}`,
    offsetMs,
    createdAt: 0,
  });

  it("schedules all audible Tracks' selected Takes together, offset-corrected", () => {
    const trackA = makeTrack({
      id: "a",
      takes: [take("take-a", "a", 50)],
      selectedTakeId: "take-a",
    });
    const trackB = makeTrack({
      id: "b",
      takes: [take("take-b", "b", -50)],
      selectedTakeId: "take-b",
    });
    const schedule = buildCompositeSchedule([trackA, trackB], new Map());
    expect(schedule.entries.map((e) => e.takeId)).toEqual(["take-a", "take-b"]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([100, 0]);
  });

  it("returns an empty schedule for an empty Track list", () => {
    expect(buildCompositeSchedule([], new Map())).toEqual({ entries: [] });
  });
});

describe("computeGridLayout", () => {
  it("returns one cell per visible (audible) Track", () => {
    const tracks = [
      makeTrack({ id: "a", selectedTakeId: "t1" }),
      makeTrack({ id: "b", selectedTakeId: "t2" }),
      makeTrack({ id: "c", selectedTakeId: "t3", mute: true }),
    ];
    const layout = computeGridLayout(tracks);
    expect(layout.map((c) => c.trackId)).toEqual(["a", "b"]);
  });

  it("arranges cells into a near-square grid and reports shared row/col counts", () => {
    const tracks = [
      makeTrack({ id: "a", selectedTakeId: "t1" }),
      makeTrack({ id: "b", selectedTakeId: "t2" }),
      makeTrack({ id: "c", selectedTakeId: "t3" }),
    ];
    const layout = computeGridLayout(tracks);
    expect(layout).toEqual([
      { trackId: "a", row: 0, col: 0, rows: 2, cols: 2 },
      { trackId: "b", row: 0, col: 1, rows: 2, cols: 2 },
      { trackId: "c", row: 1, col: 0, rows: 2, cols: 2 },
    ]);
  });

  it("returns an empty layout for an empty Track list", () => {
    expect(computeGridLayout([])).toEqual([]);
  });
});
