import { describe, it, expect } from "vitest";
import { FakeDiagnosticsStorageAdapter } from "./fakeDiagnosticsStorageAdapter";
import { buildReport } from "./report";

describe("FakeDiagnosticsStorageAdapter", () => {
  const report = buildReport(
    [
      { type: "padding-started", requestedDurationMs: 1000, atMs: 0 },
      { type: "padding-ended", atMs: 1000 },
      { type: "count-in-started", requestedDurationMs: 2400, beats: 4, bars: 1, atMs: 1000 },
      { type: "count-in-ended", atMs: 3400 },
      {
        type: "schedule-built",
        purpose: "monitor-mix",
        entries: [{ takeId: "take-1", startAtMs: 3390, offsetMs: -10 }],
        atMs: 3400,
      },
      { type: "capture-started", trackId: "track-2", atMs: 3401 },
    ],
    {
      createdAt: "2026-07-25T12:00:00.000Z",
      audioClock: { sessionId: "audio-clock-abc", createdAtEpochMs: 1_700_000_000_000 },
      project: {
        name: "My Song",
        tempoBpm: 100,
        beatsPerBar: 4,
        guide: { includeInMonitorMix: true, includeInMixdown: false },
      },
    }
  );

  it("round-trips a report unchanged", async () => {
    const storage = new FakeDiagnosticsStorageAdapter();
    const path = await storage.writeReport(report);

    expect(storage.readReport(path)).toEqual(report);
  });

  it("writes each report to its own timestamped path", async () => {
    const storage = new FakeDiagnosticsStorageAdapter();
    await storage.writeReport(report);
    await storage.writeReport({ ...report, createdAt: "2026-07-25T12:00:05.000Z" });

    expect(storage.writtenPaths()).toEqual([
      "report-2026-07-25T12-00-00-000Z.json",
      "report-2026-07-25T12-00-05-000Z.json",
    ]);
  });
});
