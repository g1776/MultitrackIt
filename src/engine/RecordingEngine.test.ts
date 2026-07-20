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

    it("sets the new Take's Offset from the capture adapter's measured latency, negated to compensate", async () => {
      engine.createProject("My Song");
      capture.reportedLatencyMs = 80;
      await engine.recordTake(undefined);

      await engine.stopRecording();

      const take = engine.getActiveProject()!.tracks[0].takes[0];
      expect(take.offsetMs).toBe(-80);
    });

    it("defaults the new Take's Offset to 0 when the capture adapter reports no latency estimate", async () => {
      engine.createProject("My Song");
      capture.reportedLatencyMs = undefined;
      await engine.recordTake(undefined);

      await engine.stopRecording();

      const take = engine.getActiveProject()!.tracks[0].takes[0];
      expect(take.offsetMs).toBe(0);
    });

    it("defaults the new Take's Offset to 0 when the capture adapter doesn't implement latency reporting", async () => {
      const noLatencyCapture: import("./adapters").CaptureAdapter = {
        startCapture: () => capture.startCapture(),
        stopCapture: (handle) => capture.stopCapture(handle),
      };
      const bareEngine = new RecordingEngine(noLatencyCapture, playback);
      bareEngine.createProject("My Song");
      await bareEngine.recordTake(undefined);

      await bareEngine.stopRecording();

      const take = bareEngine.getActiveProject()!.tracks[0].takes[0];
      expect(take.offsetMs).toBe(0);
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

  describe("renameTrack", () => {
    it("changes the Track's name", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;

      engine.renameTrack(trackId, "Lead Vocal");

      expect(engine.getActiveProject()!.tracks[0].name).toBe("Lead Vocal");
    });

    it("throws when renaming an unknown Track", () => {
      engine.createProject("My Song");
      expect(() => engine.renameTrack("nope", "X")).toThrow();
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

    it("marks muted Tracks as muted entries and excludes Tracks with no selected Take from the schedule", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const track1Id = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      await engine.recordTake(undefined);
      const track2Id = engine.getActiveProject()!.tracks[1].id;
      await engine.stopRecording();

      engine.setTrackMuteSolo(track2Id, { mute: true, solo: false });
      await engine.play();

      const schedule = playback.playedSchedules[playback.playedSchedules.length - 1];
      expect(schedule.entries).toHaveLength(2);
      expect(schedule.entries[0].takeId).toBe(
        engine.getActiveProject()!.tracks[0].takes[0].id
      );
      expect(schedule.entries[0].muted).toBe(false);
      expect(schedule.entries[1].takeId).toBe(
        engine.getActiveProject()!.tracks[1].takes[0].id
      );
      expect(schedule.entries[1].muted).toBe(true);
      void track1Id;
    });

    it("pushes a live mix update to the playback adapter when mute/solo changes while already playing", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const takeId = engine.getActiveProject()!.tracks[0].takes[0].id;

      await engine.play();
      expect(playback.mixUpdates).toHaveLength(0);

      engine.setTrackMuteSolo(trackId, { mute: true });

      expect(playback.mixUpdates).toHaveLength(1);
      const { updates } = playback.mixUpdates[0];
      expect(updates).toEqual([{ takeId, volume: 1, muted: true }]);
    });

    it("does not push a mix update when mute/solo changes while not playing", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();

      engine.setTrackMuteSolo(trackId, { mute: true });

      expect(playback.mixUpdates).toHaveLength(0);
    });

    it("applies each Take's Offset as the schedule's startAtMs", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const take = engine.getActiveProject()!.tracks[0].takes[0];

      await engine.setTakeOffset(take.id, 250);
      await engine.play();

      expect(playback.playedSchedules[0].entries[0].startAtMs).toBe(250);
      void trackId;
    });

    it("restarts composite playback with a recomputed schedule when a Take's Offset changes while playing", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const take = engine.getActiveProject()!.tracks[0].takes[0];

      await engine.play();
      expect(playback.playedSchedules).toHaveLength(1);
      expect(playback.stoppedHandles).toHaveLength(0);

      await engine.setTakeOffset(take.id, 250);

      expect(playback.stoppedHandles).toHaveLength(1);
      expect(playback.playedSchedules).toHaveLength(2);
      expect(playback.playedSchedules[1].entries[0].startAtMs).toBe(250);
      expect(engine.getStatus()).toBe("playing");
      void trackId;
    });

    it("does not restart playback when a Take's Offset changes while not playing", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();
      const take = engine.getActiveProject()!.tracks[0].takes[0];

      await engine.setTakeOffset(take.id, 250);

      expect(playback.playedSchedules).toHaveLength(0);
      expect(playback.stoppedHandles).toHaveLength(0);
    });
  });

  describe("Monitor Mix during recording", () => {
    it("plays back previously recorded Tracks, offset-corrected, when recording a new Take on a different Track", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const firstTrackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();
      const firstTake = engine.getActiveProject()!.tracks[0].takes[0];
      await engine.setTakeOffset(firstTake.id, 150);

      await engine.recordTake(undefined);

      expect(playback.playedSchedules).toHaveLength(1);
      const monitorSchedule = playback.playedSchedules[0];
      expect(monitorSchedule.entries).toHaveLength(1);
      expect(monitorSchedule.entries[0].takeId).toBe(firstTake.id);
      expect(monitorSchedule.entries[0].startAtMs).toBe(150);
      void firstTrackId;
    });

    it("does not start Monitor Mix playback when recording the very first Take", async () => {
      engine.createProject("My Song");

      await engine.recordTake(undefined);

      expect(playback.playedSchedules).toHaveLength(0);
    });

    it("excludes the Track currently being recorded onto from the Monitor Mix", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      const trackId = engine.getActiveProject()!.tracks[0].id;
      await engine.stopRecording();

      await engine.recordTake(trackId);

      expect(playback.playedSchedules).toHaveLength(0);
    });

    it("stops Monitor Mix playback when recording stops", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();

      await engine.recordTake(undefined);
      await engine.stopRecording();

      expect(playback.stoppedHandles).toHaveLength(1);
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

  describe("importGuide", () => {
    it("sets the Project's Guide, distinct from any Track, with no Takes", () => {
      engine.createProject("My Song");

      const guide = engine.importGuide("guide-media-ref");

      expect(guide.mediaRef).toBe("guide-media-ref");
      expect(engine.getActiveProject()!.guide).toEqual({ mediaRef: "guide-media-ref" });
      expect(engine.getActiveProject()!.tracks).toEqual([]);
    });

    it("replaces a previously imported Guide", () => {
      engine.createProject("My Song");
      engine.importGuide("first-guide");

      engine.importGuide("second-guide");

      expect(engine.getActiveProject()!.guide).toEqual({ mediaRef: "second-guide" });
    });

    it("throws when importing a Guide with no active Project", () => {
      expect(() => engine.importGuide("guide-media-ref")).toThrow();
    });
  });

  describe("Guide during recording and playback", () => {
    it("includes the Guide in the Monitor Mix at its Monitor Mix level while recording", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      engine.setMonitorMixLevel("guide", 0.6);

      await engine.recordTake(undefined);

      expect(playback.playedSchedules).toHaveLength(1);
      const monitorSchedule = playback.playedSchedules[0];
      expect(monitorSchedule.entries).toEqual([
        { takeId: "guide", mediaRef: "guide-media-ref", startAtMs: 0, volume: 0.6, muted: false },
      ]);
    });

    it("excludes the Guide from composite playback by default", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      await engine.recordTake(undefined);
      await engine.stopRecording();

      await engine.play();

      const schedule = playback.playedSchedules[playback.playedSchedules.length - 1];
      expect(schedule.entries.some((e) => e.takeId === "guide")).toBe(false);
    });
  });
});
