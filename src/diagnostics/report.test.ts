import { describe, it, expect } from "vitest";
import {
  buildReport,
  guideWouldBeSilentWhileRecording,
  reportFileName,
  summariseProject,
} from "./report";
import type { TimestampedEngineEvent } from "../engine/events";
import type { Project } from "../engine/types";

const PROJECT = { name: "My Song", tempoBpm: 100, beatsPerBar: 4, guide: null };

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
  return buildReport(events, { createdAt: CREATED_AT, project: PROJECT });
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
