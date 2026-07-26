import { describe, it, expect, beforeEach } from "vitest";
import { RecordingEngine } from "./RecordingEngine";
import { FakeCaptureAdapter, FakeCountInAdapter, FakePlaybackAdapter } from "./fakeAdapters";
import { createFakeEventSink } from "../diagnostics/fakeEventSink";
import type { EngineEventLog } from "../diagnostics/eventLog";
import type { TimestampedEngineEvent } from "./events";

/** Options giving a recording no padding and no counted bars, so it starts capturing immediately. */
const NO_LEAD_IN = { countInBars: 0, countInPaddingMs: 0 } as const;

function types(events: TimestampedEngineEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("RecordingEngine event sink", () => {
  let capture: FakeCaptureAdapter;
  let playback: FakePlaybackAdapter;
  let countIn: FakeCountInAdapter;
  let events: EngineEventLog;

  beforeEach(() => {
    capture = new FakeCaptureAdapter();
    playback = new FakePlaybackAdapter();
    countIn = new FakeCountInAdapter();
    events = createFakeEventSink();
  });

  function newEngine(options: { countInBars?: number; countInPaddingMs?: number } = NO_LEAD_IN) {
    return new RecordingEngine(capture, playback, { countIn, events, ...options });
  }

  it("emits the lead-in in order: padding, then Count-in, then capture", async () => {
    const engine = newEngine({ countInBars: 1, countInPaddingMs: 0 });
    engine.createProject("My Song", { bpm: 6000, beatsPerBar: 4 });
    await engine.recordTake(undefined);

    expect(types(events.getEvents())).toEqual([
      "schedule-built",
      "padding-started",
      "padding-ended",
      "count-in-started",
      "count-in-ended",
      "capture-started",
    ]);
  });

  it("states the Count-in the tempo and bar count imply, so it isn't inferred from a residual", async () => {
    const engine = newEngine({ countInBars: 2, countInPaddingMs: 0 });
    engine.createProject("My Song", { bpm: 6000, beatsPerBar: 3 });
    await engine.recordTake(undefined);

    const started = events.getEvents().find((e) => e.type === "count-in-started")!;
    expect(started).toMatchObject({ bars: 2, beats: 6, requestedDurationMs: 60 });
  });

  it("stamps events in the order they happened", async () => {
    const engine = newEngine();
    engine.createProject("My Song");
    await engine.recordTake(undefined);

    const stamps = events.getEvents().map((e) => e.atMs);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("carries each Monitor Mix schedule entry's start time and originating Offset", async () => {
    const engine = newEngine();
    engine.createProject("My Song");
    capture.reportedLatencyMs = 30;
    await engine.recordTake(undefined);
    await engine.stopRecording();

    const firstTakeId = engine.getActiveProject()!.tracks[0].takes[0].id;

    events.clear();
    await engine.recordTake(undefined);

    const built = events.getEvents().find((e) => e.type === "schedule-built")!;
    expect(built).toMatchObject({ purpose: "monitor-mix" });
    // The first Take's latency correction put it at -30ms; with no lead-in to
    // absorb it, normalization shifts the whole mix forward to 0 — the Offset
    // it came from is reported alongside so the shift is visible, not implied.
    expect(built.type === "schedule-built" && built.entries).toEqual([
      { takeId: firstTakeId, startAtMs: 0, offsetMs: -30 },
    ]);
  });

  it("reports the Take a stopped capture produced, with its Offset", async () => {
    const engine = newEngine();
    engine.createProject("My Song");
    capture.reportedLatencyMs = 12;
    await engine.recordTake(undefined);
    events.clear();
    await engine.stopRecording();

    expect(events.getEvents()[0]).toMatchObject({
      type: "capture-stopped",
      offsetMs: -12,
    });
  });

  it("emits schedule and playback events for a playback pass too, not just recording", async () => {
    const engine = newEngine();
    engine.createProject("My Song");
    await engine.recordTake(undefined);
    await engine.stopRecording();

    events.clear();
    await engine.play();
    await engine.stop();

    expect(types(events.getEvents())).toEqual([
      "schedule-built",
      "playback-started",
      "playback-stopped",
    ]);
    const built = events.getEvents()[0];
    expect(built.type === "schedule-built" && built.purpose).toBe("composite");
  });

  it("emits nothing about a pass when no sink is supplied", async () => {
    const engine = new RecordingEngine(capture, playback, { countIn, ...NO_LEAD_IN });
    engine.createProject("My Song");
    await engine.recordTake(undefined);
    await engine.stopRecording();

    expect(events.getEvents()).toEqual([]);
  });
});
