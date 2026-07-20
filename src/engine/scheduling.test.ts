import { describe, it, expect } from "vitest";
import {
  computePlaybackSchedule,
  selectAudibleTracks,
  buildMonitorMixSchedule,
  buildCompositeSchedule,
  buildMixUpdates,
  computeGridLayout,
} from "./scheduling";
import type { Guide, Track } from "./types";

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
      null,
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
      null,
      new Map([["a", 0.3]]),
      undefined
    );
    expect(schedule.entries[0].volume).toBe(0.3);
  });

  it("returns an empty schedule when there are no other recorded Tracks and no Guide", () => {
    const recordingTrack = makeTrack({ id: "c" });
    const schedule = buildMonitorMixSchedule([recordingTrack], null, new Map(), "c");
    expect(schedule.entries).toEqual([]);
  });

  it("includes the Guide at its Monitor Mix level, starting at 0", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false };
    const schedule = buildMonitorMixSchedule(
      [],
      guide,
      new Map([["guide", 0.4]]),
      undefined
    );
    expect(schedule.entries).toEqual([
      { takeId: "guide", mediaRef: "guide-media", startAtMs: 0, volume: 0.4, muted: false },
    ]);
  });

  it("defaults the Guide's Monitor Mix volume to 1 when no level is set", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false };
    const schedule = buildMonitorMixSchedule([], guide, new Map(), undefined);
    expect(schedule.entries[0].volume).toBe(1);
  });

  it("syncs the Guide alongside Track Takes, sharing the same negative-offset shift", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false };
    const trackA = makeTrack({
      id: "a",
      takes: [take("take-a", "a", -100)],
      selectedTakeId: "take-a",
    });
    const schedule = buildMonitorMixSchedule([trackA], guide, new Map(), undefined);
    expect(schedule.entries.map((e) => ({ takeId: e.takeId, startAtMs: e.startAtMs }))).toEqual([
      { takeId: "take-a", startAtMs: 0 },
      { takeId: "guide", startAtMs: 100 },
    ]);
  });

  it("excludes the Guide when includeInMonitorMix is false", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: false, includeInMixdown: false };
    const schedule = buildMonitorMixSchedule([], guide, new Map(), undefined);
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
    const schedule = buildCompositeSchedule([trackA, trackB], null, new Map());
    expect(schedule.entries.map((e) => e.takeId)).toEqual(["take-a", "take-b"]);
    expect(schedule.entries.map((e) => e.startAtMs)).toEqual([100, 0]);
  });

  it("returns an empty schedule for an empty Track list and no Guide", () => {
    expect(buildCompositeSchedule([], null, new Map())).toEqual({ entries: [] });
  });

  it("includes muted/non-soloed Tracks as muted entries rather than omitting them, so playback stays in sync when mute/solo changes later", () => {
    const trackA = makeTrack({
      id: "a",
      takes: [take("take-a", "a", 0)],
      selectedTakeId: "take-a",
      mute: true,
    });
    const trackB = makeTrack({
      id: "b",
      takes: [take("take-b", "b", 0)],
      selectedTakeId: "take-b",
      solo: true,
    });
    const trackC = makeTrack({
      id: "c",
      takes: [take("take-c", "c", 0)],
      selectedTakeId: "take-c",
    });
    const schedule = buildCompositeSchedule([trackA, trackB, trackC], null, new Map());
    expect(schedule.entries.map((e) => ({ takeId: e.takeId, muted: e.muted }))).toEqual([
      { takeId: "take-a", muted: true },
      { takeId: "take-b", muted: false },
      { takeId: "take-c", muted: true },
    ]);
  });

  it("includes the Guide as a muted entry by default (excluded from Mixdown)", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false };
    const schedule = buildCompositeSchedule([], guide, new Map());
    expect(schedule.entries).toEqual([
      { takeId: "guide", mediaRef: "guide-media", startAtMs: 0, volume: 1, muted: true },
    ]);
  });

  it("includes the Guide as an unmuted entry when includeInMixdown is set", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: true };
    const schedule = buildCompositeSchedule([], guide, new Map([["guide", 0.7]]));
    expect(schedule.entries).toEqual([
      { takeId: "guide", mediaRef: "guide-media", startAtMs: 0, volume: 0.7, muted: false },
    ]);
  });
});

describe("buildMixUpdates", () => {
  it("computes muted/volume per Track honoring solo exclusivity and mute", () => {
    const trackA = makeTrack({ id: "a", selectedTakeId: "take-a", mute: true });
    const trackB = makeTrack({ id: "b", selectedTakeId: "take-b", solo: true });
    const trackC = makeTrack({ id: "c", selectedTakeId: "take-c" });
    const updates = buildMixUpdates(
      [trackA, trackB, trackC],
      null,
      new Map([["b", 0.5]])
    );
    expect(updates).toEqual([
      { takeId: "take-a", volume: 1, muted: true },
      { takeId: "take-b", volume: 0.5, muted: false },
      { takeId: "take-c", volume: 1, muted: true },
    ]);
  });

  it("skips Tracks with no selected Take", () => {
    const track = makeTrack({ id: "a", selectedTakeId: null });
    expect(buildMixUpdates([track], null, new Map())).toEqual([]);
  });

  it("includes a Guide update reflecting includeInMixdown", () => {
    const guide: Guide = { mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: true };
    const updates = buildMixUpdates([], guide, new Map([["guide", 0.9]]));
    expect(updates).toEqual([{ takeId: "guide", volume: 0.9, muted: false }]);
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
