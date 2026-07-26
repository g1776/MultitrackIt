import { describe, it, expect } from "vitest";
import {
  buildReport,
  guideWouldBeSilentWhileRecording,
  reportFileName,
  summariseProject,
} from "./report";
import type { TimestampedEngineEvent } from "../engine/events";
import type { Project } from "../engine/types";
import { describeAudioProcessing } from "./audioProcessing";

const PROJECT = { name: "My Song", tempoBpm: 100, beatsPerBar: 4, guide: null };
const AUDIO_CLOCK = { sessionId: "audio-clock-abc", createdAtEpochMs: 1_700_000_000_000 };

function project(guide: Project["guide"]): Project {
  return {
    id: "project-1",
    name: "My Song",
    createdAt: 0,
    tracks: [],
    guide,
    tempoBpm: 100,
    beatsPerBar: 4,
  };
}
const CREATED_AT = "2026-07-25T12:00:00.000Z";

function report(events: TimestampedEngineEvent[]) {
  return buildReport(events, {
    createdAt: CREATED_AT,
    project: PROJECT,
    audioClock: AUDIO_CLOCK,
    audioProcessing: null,
    scenario: null,
  });
}

describe("buildReport", () => {
  it("records the Count-in as both requested and actually elapsed", () => {
    const built = report([
      { type: "padding-started", requestedDurationMs: 1000, atMs: 0 },
      { type: "padding-ended", atMs: 1012 },
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 1012 },
      { type: "count-in-ended", atMs: 3450 },
    ]);

    expect(built.padding).toEqual({ requestedMs: 1000, actualMs: 1012 });
    expect(built.countIn).toEqual({ requestedMs: 2400, actualMs: 2438, bars: 1, beats: 4 });
  });

  it("summarises the latest pass when the log spans several, not the first", () => {
    const built = report([
      { type: "padding-started", requestedDurationMs: 1000, atMs: 0 },
      { type: "padding-ended", atMs: 1500 },
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 1500 },
      { type: "count-in-ended", atMs: 3900 },
      { type: "padding-started", requestedDurationMs: 1000, atMs: 9000 },
      { type: "padding-ended", atMs: 10001 },
      { type: "count-in-started", requestedDurationMs: 1200, beats: 2, bars: 1, atMs: 10001 },
      { type: "count-in-ended", atMs: 11203 },
    ]);

    expect(built.padding).toEqual({ requestedMs: 1000, actualMs: 1001 });
    expect(built.countIn).toEqual({ requestedMs: 1200, actualMs: 1202, bars: 1, beats: 2 });
  });

  it("reports an interval the pass never finished as null rather than zero", () => {
    const built = report([
      { type: "padding-started", requestedDurationMs: 1000, atMs: 0 },
      { type: "padding-ended", atMs: 1000 },
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 1000 },
    ]);

    expect(built.countIn.requestedMs).toBe(2400);
    expect(built.countIn.actualMs).toBeNull();
  });

  it("reports a playback-only pass with no lead-in at all", () => {
    const built = report([
      { type: "schedule-built", purpose: "composite", entries: [], atMs: 5 },
      { type: "playback-started", purpose: "composite", atMs: 6 },
    ]);

    expect(built.padding).toEqual({ requestedMs: null, actualMs: null });
    expect(built.countIn).toEqual({ requestedMs: null, actualMs: null, bars: null, beats: null });
  });

  it("carries the full event timeline and the Project it ran against", () => {
    const events: TimestampedEngineEvent[] = [
      { type: "playback-started", purpose: "composite", atMs: 1 },
      { type: "playback-stopped", purpose: "composite", atMs: 2 },
    ];
    const built = report(events);

    expect(built.events).toEqual(events);
    expect(built.project).toEqual(PROJECT);
    expect(built.createdAt).toBe(CREATED_AT);
  });
});

describe("buildReport captureStart", () => {
  it("states how late capture began relative to the timeline's zero point", () => {
    const built = report([
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 810 },
      { type: "count-in-ended", atMs: 3210 },
      { type: "capture-started", trackId: "track-2", atMs: 3941 },
    ]);

    // Capture is meant to begin exactly when the Count-in ends — that instant
    // is the timeline's zero point, so a non-zero value here displaces every
    // Take in the pass from the Guide by that much.
    expect(built.captureStart.delayAfterCountInMs).toBe(731);
  });

  it("states zero — not null — when capture began exactly on the zero point", () => {
    const built = report([
      { type: "count-in-ended", atMs: 3210 },
      { type: "capture-started", trackId: "track-2", atMs: 3210 },
    ]);

    expect(built.captureStart.delayAfterCountInMs).toBe(0);
  });

  it("reports null for a pass abandoned before capture ever started", () => {
    const built = report([
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 810 },
      { type: "count-in-ended", atMs: 3210 },
    ]);

    expect(built.captureStart.delayAfterCountInMs).toBeNull();
  });

  it("never pairs the latest Count-in with an earlier pass's capture", () => {
    const built = report([
      { type: "count-in-ended", atMs: 1000 },
      { type: "capture-started", trackId: "track-1", atMs: 1700 },
      { type: "capture-stopped", trackId: "track-1", takeId: "take-1", offsetMs: 0, atMs: 9000 },
      { type: "count-in-ended", atMs: 12000 },
    ]);

    expect(built.captureStart.delayAfterCountInMs).toBeNull();
  });

  it("has nothing to say about a playback-only pass", () => {
    const built = report([{ type: "playback-started", purpose: "composite", atMs: 5 }]);

    expect(built.captureStart.delayAfterCountInMs).toBeNull();
  });
});

describe("buildReport audioClock", () => {
  it("names the clock its timestamps were stamped against", () => {
    expect(report([]).audioClock).toEqual(AUDIO_CLOCK);
  });

  it("says so plainly when no AudioContext existed yet", () => {
    const built = buildReport([], {
      createdAt: CREATED_AT,
      project: PROJECT,
      audioClock: null,
      audioProcessing: null,
      scenario: null,
    });

    expect(built.audioClock).toBeNull();
  });
});

describe("buildReport audioProcessing", () => {
  it("states the processing the captured audio actually passed through", () => {
    const audioProcessing = describeAudioProcessing({
      echoCancellation: true,
      autoGainControl: false,
      noiseSuppression: false,
    });
    const built = buildReport([], {
      createdAt: CREATED_AT,
      project: PROJECT,
      audioClock: AUDIO_CLOCK,
      audioProcessing,
      scenario: null,
    });

    expect(built.audioProcessing).toEqual(audioProcessing);
    expect(built.audioProcessing?.stillActive).toEqual(["echoCancellation"]);
  });

  it("says nothing about processing for a pass that never captured", () => {
    expect(report([]).audioProcessing).toBeNull();
  });
});

describe("buildReport scenario", () => {
  it("states the scenario parameters a synthetic run was made with, so it's reproducible from its own report", () => {
    const scenario = { trackCount: 3, tempoBpm: 100, beatsPerBar: 4, beatCount: 16, armDelayMs: 0 };
    const built = buildReport([], {
      createdAt: CREATED_AT,
      project: PROJECT,
      audioClock: AUDIO_CLOCK,
      audioProcessing: null,
      scenario,
    });

    expect(built.scenario).toEqual(scenario);
  });

  it("is null for an ordinary manual pass", () => {
    expect(report([]).scenario).toBeNull();
  });
});

describe("summariseProject", () => {
  it("states an absent Guide explicitly rather than by omission", () => {
    expect(summariseProject(project(null))).toEqual({
      name: "My Song",
      tempoBpm: 100,
      beatsPerBar: 4,
      guide: null,
    });
  });

  it("states whether a Guide that exists would actually sound in each kind of pass", () => {
    const summary = summariseProject(
      project({ mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false })
    );

    expect(summary?.guide).toEqual({ includeInMonitorMix: true, includeInMixdown: false });
  });

  it("keeps the Guide's mediaRef out of the report — a blob handle means nothing later", () => {
    const summary = summariseProject(
      project({ mediaRef: "blob:xyz", includeInMonitorMix: true, includeInMixdown: true })
    );

    expect(JSON.stringify(summary)).not.toContain("blob:xyz");
  });

  it("has no Project to summarise before one is open", () => {
    expect(summariseProject(null)).toBeNull();
  });
});

describe("guideWouldBeSilentWhileRecording", () => {
  it("flags a Project with no Guide at all", () => {
    expect(guideWouldBeSilentWhileRecording(summariseProject(project(null)))).toBe(true);
  });

  it("flags a Guide excluded from the Monitor Mix — imported, but silent while recording", () => {
    const summary = summariseProject(
      project({ mediaRef: "guide-media", includeInMonitorMix: false, includeInMixdown: true })
    );

    expect(guideWouldBeSilentWhileRecording(summary)).toBe(true);
  });

  it("stays quiet when a Guide will sound", () => {
    const summary = summariseProject(
      project({ mediaRef: "guide-media", includeInMonitorMix: true, includeInMixdown: false })
    );

    expect(guideWouldBeSilentWhileRecording(summary)).toBe(false);
  });
});

describe("reportFileName", () => {
  it("names a report after its ISO timestamp, without characters a path can't hold", () => {
    expect(reportFileName(CREATED_AT)).toBe("report-2026-07-25T12-00-00-000Z.json");
  });
});
