import { describe, it, expect } from "vitest";
import { prepareSnapshotForSave, rehydrateSnapshot } from "./projectPersistence";
import { FakeProjectStorageAdapter } from "./fakeStorageAdapter";
import type { ProjectSnapshot } from "./types";

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: "project-1",
    name: "My Song",
    createdAt: 0,
    tracks: [],
    guide: null,
    monitorMix: [],
    ...overrides,
  };
}

describe("prepareSnapshotForSave", () => {
  it("rewrites Take mediaRefs to stable file names and collects their bytes", async () => {
    const snapshot = makeSnapshot({
      tracks: [
        {
          id: "track-1",
          name: "Track 1",
          mute: false,
          solo: false,
          selectedTakeId: "take-1",
          takes: [
            { id: "take-1", trackId: "track-1", mediaRef: "blob:live-ref-1", offsetMs: 0, createdAt: 0 },
          ],
        },
      ],
    });

    const fetchMedia = async (ref: string) => ({
      bytes: new TextEncoder().encode(`bytes-for-${ref}`).buffer,
      mimeType: "video/webm",
    });

    const { snapshot: prepared, media } = await prepareSnapshotForSave(snapshot, fetchMedia);

    expect(prepared.tracks[0].takes[0].mediaRef).toBe("take-1.webm");
    expect(media).toHaveLength(1);
    expect(media[0].ref).toBe("take-1.webm");
    expect(media[0].mimeType).toBe("video/webm");
  });

  it("rewrites the Guide's mediaRef too", async () => {
    const snapshot = makeSnapshot({
      guide: { mediaRef: "blob:guide-ref", includeInMonitorMix: true, includeInMixdown: false },
    });
    const fetchMedia = async () => ({ bytes: new ArrayBuffer(4), mimeType: "audio/wav" });

    const { snapshot: prepared, media } = await prepareSnapshotForSave(snapshot, fetchMedia);

    expect(prepared.guide?.mediaRef).toBe("guide.wav");
    expect(media.map((m) => m.ref)).toEqual(["guide.wav"]);
  });

  it("fetches a shared mediaRef only once even if reused across Takes", async () => {
    let fetchCount = 0;
    const snapshot = makeSnapshot({
      tracks: [
        {
          id: "track-1",
          name: "Track 1",
          mute: false,
          solo: false,
          selectedTakeId: "take-1",
          takes: [
            { id: "take-1", trackId: "track-1", mediaRef: "shared-ref", offsetMs: 0, createdAt: 0 },
            { id: "take-2", trackId: "track-1", mediaRef: "shared-ref", offsetMs: 0, createdAt: 0 },
          ],
        },
      ],
    });
    const fetchMedia = async () => {
      fetchCount += 1;
      return { bytes: new ArrayBuffer(1), mimeType: "video/webm" };
    };

    await prepareSnapshotForSave(snapshot, fetchMedia);

    expect(fetchCount).toBe(1);
  });
});

describe("rehydrateSnapshot", () => {
  it("rewrites Take/Guide mediaRefs from stable file names back to fresh live refs", () => {
    const saved = {
      snapshot: makeSnapshot({
        tracks: [
          {
            id: "track-1",
            name: "Track 1",
            mute: false,
            solo: false,
            selectedTakeId: "take-1",
            takes: [
              { id: "take-1", trackId: "track-1", mediaRef: "take-1.webm", offsetMs: 0, createdAt: 0 },
            ],
          },
        ],
        guide: { mediaRef: "guide.wav", includeInMonitorMix: true, includeInMixdown: false },
      }),
      media: [
        { ref: "take-1.webm", bytes: new ArrayBuffer(2), mimeType: "video/webm" },
        { ref: "guide.wav", bytes: new ArrayBuffer(2), mimeType: "audio/wav" },
      ],
    };

    const createMediaRef = (bytes: ArrayBuffer, mimeType: string) =>
      `live-ref-for-${mimeType}-${bytes.byteLength}`;

    const rehydrated = rehydrateSnapshot(saved, createMediaRef);

    expect(rehydrated.tracks[0].takes[0].mediaRef).toBe("live-ref-for-video/webm-2");
    expect(rehydrated.guide?.mediaRef).toBe("live-ref-for-audio/wav-2");
  });

  it("throws when a referenced media file is missing", () => {
    const saved = {
      snapshot: makeSnapshot({
        guide: { mediaRef: "missing.wav", includeInMonitorMix: true, includeInMixdown: false },
      }),
      media: [],
    };

    expect(() => rehydrateSnapshot(saved, () => "ref")).toThrow();
  });
});

describe("FakeProjectStorageAdapter", () => {
  it("round-trips a saved Project through save/load/list", async () => {
    const adapter = new FakeProjectStorageAdapter();
    const snapshot = makeSnapshot({ id: "p1", name: "Song A" });

    await adapter.saveProject(snapshot, []);

    expect(await adapter.loadProject("p1")).toEqual({ snapshot, media: [] });
    expect(await adapter.listProjects()).toEqual([{ id: "p1", name: "Song A", updatedAt: 0 }]);
    expect(await adapter.loadProject("unknown")).toBeNull();
  });
});
