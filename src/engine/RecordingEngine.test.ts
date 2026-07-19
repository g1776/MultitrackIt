import { describe, it, expect, beforeEach } from "vitest";
import { RecordingEngine } from "./RecordingEngine";
import { FakeCaptureAdapter, FakePlaybackAdapter } from "./fakeAdapters";

describe("RecordingEngine", () => {
  let capture: FakeCaptureAdapter;
  let playback: FakePlaybackAdapter;
  let engine: RecordingEngine;

  beforeEach(() => {
    capture = new FakeCaptureAdapter();
    playback = new FakePlaybackAdapter();
    engine = new RecordingEngine(capture, playback);
  });

  describe("createProject", () => {
    it("creates a Project by name and makes it the active Project", () => {
      engine.createProject("My Song");
      const project = engine.getActiveProject();
      expect(project?.name).toBe("My Song");
      expect(project?.tracks).toEqual([]);
    });
  });

  describe("recordTake with no existing Track", () => {
    it("implicitly creates a new auto-named Track and starts capturing", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      const project = engine.getActiveProject()!;
      expect(project.tracks).toHaveLength(1);
      expect(project.tracks[0].name).toBe("Track 1");
      expect(engine.getStatus()).toBe("recording");
      expect(capture.startedHandles).toHaveLength(1);
    });

    it("auto-names successive implicit Tracks sequentially", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();
      await engine.recordTake(undefined);

      const project = engine.getActiveProject()!;
      expect(project.tracks.map((t) => t.name)).toEqual(["Track 1", "Track 2"]);
    });
  });

  describe("stopRecording", () => {
    it("creates a Take on the Track, marks it selected, and returns to idle with no auto-playback", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;

      await engine.stopRecording();

      const track = engine.getActiveProject()!.tracks[0];
      expect(track.takes).toHaveLength(1);
      expect(track.selectedTakeId).toBe(track.takes[0].id);
      expect(track.takes[0].trackId).toBe(trackId);
      expect(engine.getStatus()).toBe("idle");
      expect(playback.playedSchedules).toHaveLength(0);
    });
  });

  describe("recordTake on an existing Track", () => {
    it("appends a new Take without discarding prior Takes, and selects the newest", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const firstTakeId = engine.getActiveProject()!.tracks[0].takes[0].id;

      await engine.recordTake(trackId);
      await engine.stopRecording();

      const track = engine.getActiveProject()!.tracks[0];
      expect(track.takes).toHaveLength(2);
      expect(track.takes[0].id).toBe(firstTakeId);
      expect(track.selectedTakeId).toBe(track.takes[1].id);
    });
  });

  describe("selectTake", () => {
    it("changes which Take is selected on a Track", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const firstTakeId = engine.getActiveProject()!.tracks[0].takes[0].id;
      await engine.recordTake(trackId);
      await engine.stopRecording();

      engine.selectTake(trackId, firstTakeId);

      expect(engine.getActiveProject()!.tracks[0].selectedTakeId).toBe(firstTakeId);
    });
  });

  describe("play", () => {
    it("plays back a Track's selected Take (audio+video together)", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const take = engine.getActiveProject()!.tracks[0].takes[0];

      await engine.play();

      expect(engine.getStatus()).toBe("playing");
      expect(playback.playedSchedules).toHaveLength(1);
      const schedule = playback.playedSchedules[0];
      expect(schedule.entries).toHaveLength(1);
      expect(schedule.entries[0].takeId).toBe(take.id);
      expect(schedule.entries[0].mediaRef).toBe(take.mediaRef);
      void trackId;
    });

    it("excludes muted Tracks and Tracks with no selected Take from the schedule", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const track1Id = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      await engine.recordTake(undefined);
      const track2Id = engine.getActiveProject()!.tracks[1].id;
      await engine.stopRecording();

      engine.setTrackMuteSolo(track2Id, { mute: true, solo: false });
      await engine.play();

      const schedule = playback.playedSchedules[0];
      expect(schedule.entries).toHaveLength(1);
      expect(schedule.entries[0].takeId).toBe(
        engine.getActiveProject()!.tracks[0].takes[0].id
      );
      void track1Id;
    });

    it("applies each Take's Offset as the schedule's startAtMs", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const take = engine.getActiveProject()!.tracks[0].takes[0];

      engine.setTakeOffset(take.id, 250);
      await engine.play();

      expect(playback.playedSchedules[0].entries[0].startAtMs).toBe(250);
      void trackId;
    });
  });

  describe("stop", () => {
    it("stops playback and returns to idle", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();
      await engine.play();

      await engine.stop();

      expect(engine.getStatus()).toBe("idle");
      expect(playback.stoppedHandles).toHaveLength(1);
    });
  });

  describe("concurrent operation guards", () => {
    it("rejects starting a new recording while already recording", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      await expect(engine.recordTake(undefined)).rejects.toThrow();
    });

    it("rejects starting playback while recording", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      await expect(engine.play()).rejects.toThrow();
    });
  });

  describe("setMonitorMixLevel", () => {
    it("stores a monitor mix level independent of a Track's own mix settings", () => {
      engine.createProject("My Song");
      engine.setMonitorMixLevel("guide", 0.5);
      expect(engine.getMonitorMixLevel("guide")).toBe(0.5);
    });
  });
});
