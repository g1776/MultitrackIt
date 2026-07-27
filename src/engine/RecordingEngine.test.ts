import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_BEATS_PER_BAR,
  DEFAULT_COUNT_IN_BARS,
  DEFAULT_COUNT_IN_PADDING_MS,
  DEFAULT_TEMPO_BPM,
  RecordingEngine,
} from "./RecordingEngine";
import { computeCountIn } from "./countIn";
import { computeMetronomeClicks } from "./metronome";
import {
  FakeCaptureAdapter,
  FakeCountInAdapter,
  FakePlaybackAdapter,
  fakeMetronomeAudio,
} from "./fakeAdapters";

/**
 * Options giving a recording no padding and no counted bars, so it starts
 * capturing immediately, and disabling idle-release so tests don't leave a
 * dangling real timer behind (arming's own tests set idleReleaseMs directly).
 */
const NO_LEAD_IN = { countInBars: 0, countInPaddingMs: 0, idleReleaseMs: 0 } as const;

describe("RecordingEngine", () => {
  let capture: FakeCaptureAdapter;
  let playback: FakePlaybackAdapter;
  let countIn: FakeCountInAdapter;
  let engine: RecordingEngine;

  beforeEach(() => {
    capture = new FakeCaptureAdapter();
    playback = new FakePlaybackAdapter();
    countIn = new FakeCountInAdapter();
    // A zero-length lead-in skips the real waits so these tests run fast;
    // lead-in sequencing itself is covered separately below.
    engine = new RecordingEngine(capture, playback, { countIn, ...NO_LEAD_IN });
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
        arm: () => capture.arm(),
        isArmed: () => capture.isArmed(),
        disarm: () => capture.disarm(),
        startCapture: () => capture.startCapture(),
        stopCapture: (handle) => capture.stopCapture(handle),
      };
      const bareEngine = new RecordingEngine(noLatencyCapture, playback, NO_LEAD_IN);
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

    it("schedules previously recorded Tracks to begin at capture start, not at lead-in start", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, { countIn, countInPaddingMs: 20 });
      leadInEngine.createProject("My Song", { bpm: 120, beatsPerBar: 1 });
      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();

      await leadInEngine.recordTake(undefined);

      // 20ms padding + one one-beat bar at 120bpm (500ms).
      expect(playback.playedSchedules[0].entries[0].startAtMs).toBe(520);
    });

    it("gives a Take recorded against a Monitor Mix an Offset of zero when no latency is reported — no lead-in term", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, { countIn, countInPaddingMs: 10 });
      leadInEngine.createProject("My Song", { bpm: 240, beatsPerBar: 1 });
      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();

      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();

      const secondTake = leadInEngine.getActiveProject()!.tracks[1].takes[0];
      expect(secondTake.offsetMs).toBe(0);
    });

    it("gives the first Take of a Guide-less Project — recorded against nothing — the same Offset rule as any other Take: exactly the negated latency, with no lead-in term", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, { countIn, countInPaddingMs: 10 });
      leadInEngine.createProject("My Song", { bpm: 240, beatsPerBar: 1 });

      capture.reportedLatencyMs = 80;
      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();
      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();

      const [firstTrack, secondTrack] = leadInEngine.getActiveProject()!.tracks;
      expect(firstTrack.takes[0].offsetMs).toBe(-80);
      expect(secondTrack.takes[0].offsetMs).toBe(-80);
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

  describe("Count-in and Count-in Padding", () => {
    it("counts in one bar by default", () => {
      engine.createProject("My Song");
      const defaultEngine = new RecordingEngine(capture, playback, { countIn });
      defaultEngine.createProject("My Song", { bpm: 120, beatsPerBar: 4 });

      const plan = defaultEngine.getCountInPlan();

      expect(DEFAULT_COUNT_IN_BARS).toBe(1);
      expect(plan.clicks).toHaveLength(4);
      expect(plan.paddingMs).toBe(DEFAULT_COUNT_IN_PADDING_MS);
    });

    it("derives the Count-in from the Project's own tempo and time signature", () => {
      const defaultEngine = new RecordingEngine(capture, playback, { countIn });
      defaultEngine.createProject("My Song", { bpm: 90, beatsPerBar: 3 });

      expect(defaultEngine.getCountInPlan()).toEqual(
        computeCountIn({
          bpm: 90,
          beatsPerBar: 3,
          bars: DEFAULT_COUNT_IN_BARS,
          paddingMs: DEFAULT_COUNT_IN_PADDING_MS,
        })
      );
    });

    it("sounds the Count-in from its own click source, accenting the downbeat, never from the Guide", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, {
        countIn,
        countInPaddingMs: 10,
      });
      leadInEngine.createProject("My Song", { bpm: 240, beatsPerBar: 4 });
      leadInEngine.importGuide("guide-media-ref");

      await leadInEngine.recordTake(undefined);

      expect(countIn.playedCountIns).toHaveLength(1);
      expect(countIn.playedCountIns[0].map((c) => c.accent)).toEqual([true, false, false, false]);
      // The Guide is scheduled, but only from capture start — it is not what
      // is sounding during the Count-in.
      expect(playback.playedSchedules[0].entries[0].startAtMs).toBe(1010);
    });

    it("passes through arming, then getting-ready, then counting-in, then recording on an unarmed Track", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, {
        countIn,
        countInPaddingMs: 20,
        idleReleaseMs: 0,
      });
      leadInEngine.createProject("My Song", { bpm: 240, beatsPerBar: 1 });
      const observed: string[] = [];
      leadInEngine.onStatusChange((status) => observed.push(status));

      await leadInEngine.recordTake(undefined);

      expect(observed).toEqual(["arming", "getting-ready", "counting-in", "recording"]);
    });

    it("skips arming on a retake, since the device is already armed", async () => {
      const leadInEngine = new RecordingEngine(capture, playback, {
        countIn,
        countInPaddingMs: 20,
        idleReleaseMs: 0,
      });
      leadInEngine.createProject("My Song", { bpm: 240, beatsPerBar: 1 });
      await leadInEngine.recordTake(undefined);
      await leadInEngine.stopRecording();

      const observed: string[] = [];
      leadInEngine.onStatusChange((status) => observed.push(status));
      await leadInEngine.recordTake(undefined);

      expect(observed).toEqual(["getting-ready", "counting-in", "recording"]);
    });

    it("stays silent during the padding, sounding no click until the Count-in begins", async () => {
      vi.useFakeTimers();
      try {
        const timedEngine = new RecordingEngine(capture, playback, {
          countIn,
          countInPaddingMs: 1000,
        });
        timedEngine.createProject("My Song", { bpm: 120, beatsPerBar: 4 });

        const recordPromise = timedEngine.recordTake(undefined);
        await vi.advanceTimersByTimeAsync(999);
        expect(timedEngine.getStatus()).toBe("getting-ready");
        expect(countIn.playedCountIns).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(timedEngine.getStatus()).toBe("counting-in");
        expect(countIn.playedCountIns).toHaveLength(1);
        expect(capture.startedHandles).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(2000);
        await recordPromise;
        expect(capture.startedHandles).toHaveLength(1);
        expect(timedEngine.getStatus()).toBe("recording");
      } finally {
        vi.useRealTimers();
      }
    });

    it("applies the padding even at a tempo whose bar is far longer than it", async () => {
      vi.useFakeTimers();
      try {
        const timedEngine = new RecordingEngine(capture, playback, {
          countIn,
          countInPaddingMs: 1000,
        });
        timedEngine.createProject("My Song", { bpm: 40, beatsPerBar: 4 });

        const recordPromise = timedEngine.recordTake(undefined);
        await vi.advanceTimersByTimeAsync(999);
        expect(countIn.playedCountIns).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1 + 6000);
        await recordPromise;
        expect(capture.startedHandles).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts capturing immediately when configured with no padding and no counted bars", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      expect(engine.getStatus()).toBe("recording");
      expect(countIn.playedCountIns).toHaveLength(0);
    });
  });

  describe("Arming", () => {
    it("acquires the device on the first Take of a session", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      expect(capture.armCount).toBe(1);
      expect(engine.isArmed()).toBe(true);
    });

    it("does not acquire again for a retake — one acquisition reused across successive Takes", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();

      await engine.recordTake(undefined);
      await engine.stopRecording();
      await engine.recordTake(undefined);

      expect(capture.armCount).toBe(1);
    });

    it("does not release the device when a Take stops — stopCapture stops recording without disarming", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      await engine.stopRecording();

      expect(capture.disarmCount).toBe(0);
      expect(engine.isArmed()).toBe(true);
    });

    it("fails at arming — before a performer has been counted in — on permission denial or an absent device", async () => {
      engine.createProject("My Song");
      capture.armError = new Error("Permission denied");

      await expect(engine.recordTake(undefined)).rejects.toThrow("Permission denied");

      expect(countIn.playedCountIns).toHaveLength(0);
      expect(capture.startedHandles).toHaveLength(0);
      expect(engine.isArmed()).toBe(false);
      expect(engine.getStatus()).toBe("idle");
    });

    it("supports arming explicitly, ahead of any recordTake call", async () => {
      engine.createProject("My Song");

      await engine.arm();

      expect(engine.isArmed()).toBe(true);
      expect(capture.armCount).toBe(1);

      await engine.recordTake(undefined);

      expect(capture.armCount).toBe(1);
    });

    it("is a no-op to arm again while already armed", async () => {
      engine.createProject("My Song");
      await engine.arm();

      await engine.arm();

      expect(capture.armCount).toBe(1);
    });

    it("supports disarming explicitly, releasing the device", async () => {
      engine.createProject("My Song");
      await engine.arm();

      await engine.disarm();

      expect(engine.isArmed()).toBe(false);
      expect(capture.disarmCount).toBe(1);
    });

    it("is a no-op to disarm while already unarmed", async () => {
      engine.createProject("My Song");

      await engine.disarm();

      expect(capture.disarmCount).toBe(0);
    });

    it("notifies armed-state listeners as the device is armed and disarmed", async () => {
      engine.createProject("My Song");
      const observed: boolean[] = [];
      engine.onArmedChange((armed) => observed.push(armed));

      await engine.arm();
      await engine.disarm();

      expect(observed).toEqual([true, false]);
    });

    it("shows the arming wait as its own status, distinct from idle, while the device is being acquired", async () => {
      vi.useFakeTimers();
      try {
        const timedEngine = new RecordingEngine(capture, playback, { countIn, ...NO_LEAD_IN });
        timedEngine.createProject("My Song");
        capture.armDelayMs = 500;

        const armPromise = timedEngine.arm();
        await vi.advanceTimersByTimeAsync(499);
        expect(timedEngine.getStatus()).toBe("arming");
        expect(timedEngine.isArmed()).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await armPromise;
        expect(timedEngine.getStatus()).toBe("idle");
        expect(timedEngine.isArmed()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases an idle armed device after idleReleaseMs of inactivity", async () => {
      vi.useFakeTimers();
      try {
        const timedEngine = new RecordingEngine(capture, playback, {
          countIn,
          countInBars: 0,
          countInPaddingMs: 0,
          idleReleaseMs: 1000,
        });
        timedEngine.createProject("My Song");

        await timedEngine.recordTake(undefined);
        await timedEngine.stopRecording();

        await vi.advanceTimersByTimeAsync(999);
        expect(capture.disarmCount).toBe(0);
        expect(timedEngine.isArmed()).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(capture.disarmCount).toBe(1);
        expect(timedEngine.isArmed()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not release the device while a retake starts before the idle timeout", async () => {
      vi.useFakeTimers();
      try {
        const timedEngine = new RecordingEngine(capture, playback, {
          countIn,
          countInBars: 0,
          countInPaddingMs: 0,
          idleReleaseMs: 1000,
        });
        timedEngine.createProject("My Song");

        await timedEngine.recordTake(undefined);
        await timedEngine.stopRecording();
        await vi.advanceTimersByTimeAsync(500);

        await timedEngine.recordTake(undefined);
        await vi.advanceTimersByTimeAsync(1000);

        expect(capture.disarmCount).toBe(0);
        expect(timedEngine.isArmed()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects arming while unarmed and busy with something else", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);
      await engine.stopRecording();
      await engine.disarm();
      await engine.play();

      await expect(engine.arm()).rejects.toThrow();
    });

    it("rejects disarming while recording", async () => {
      engine.createProject("My Song");
      await engine.recordTake(undefined);

      await expect(engine.disarm()).rejects.toThrow();
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
      expect(engine.getActiveProject()!.guide).toEqual({
        mediaRef: "guide-media-ref",
        includeInMonitorMix: true,
        includeInMixdown: false,
      });
      expect(engine.getActiveProject()!.tracks).toEqual([]);
    });

    it("replaces a previously imported Guide", () => {
      engine.createProject("My Song");
      engine.importGuide("first-guide");

      engine.importGuide("second-guide");

      expect(engine.getActiveProject()!.guide).toEqual({
        mediaRef: "second-guide",
        includeInMonitorMix: true,
        includeInMixdown: false,
      });
    });

    it("throws when importing a Guide with no active Project", () => {
      expect(() => engine.importGuide("guide-media-ref")).toThrow();
    });
  });

  describe("generateMetronomeGuide", () => {
    it("renders Metronome audio at the Project's own tempo/time signature and imports it as the Guide", () => {
      const metronomeEngine = new RecordingEngine(capture, playback, {
        countIn,
        ...NO_LEAD_IN,
        metronomeAudio: fakeMetronomeAudio,
      });
      metronomeEngine.createProject("My Song", { bpm: 120, beatsPerBar: 3 });

      const guide = metronomeEngine.generateMetronomeGuide({ durationMs: 1000 });

      expect(guide.mediaRef).toBe("metronome-120-3-1000");
      expect(guide.includeInMonitorMix).toBe(true);
      expect(guide.includeInMixdown).toBe(false);
      expect(metronomeEngine.getActiveProject()!.guide).toBe(guide);
    });

    it("attaches the rendered click schedule to the Guide, matching computeMetronomeClicks for the same params", () => {
      const metronomeEngine = new RecordingEngine(capture, playback, {
        countIn,
        ...NO_LEAD_IN,
        metronomeAudio: fakeMetronomeAudio,
      });
      metronomeEngine.createProject("My Song", { bpm: 100, beatsPerBar: 4 });

      const guide = metronomeEngine.generateMetronomeGuide({ durationMs: 2000 });

      expect(guide.metronomeSchedule).toEqual(
        computeMetronomeClicks({ bpm: 100, beatsPerBar: 4, durationMs: 2000 })
      );
    });

    it("replaces a previously imported or generated Guide", () => {
      const metronomeEngine = new RecordingEngine(capture, playback, {
        countIn,
        ...NO_LEAD_IN,
        metronomeAudio: fakeMetronomeAudio,
      });
      metronomeEngine.createProject("My Song");
      metronomeEngine.importGuide("imported-guide");

      metronomeEngine.generateMetronomeGuide({ durationMs: 1000 });

      expect(metronomeEngine.getActiveProject()!.guide?.mediaRef).not.toBe("imported-guide");
    });

    it("throws when generating a Metronome Guide with no active Project", () => {
      const metronomeEngine = new RecordingEngine(capture, playback, {
        countIn,
        ...NO_LEAD_IN,
        metronomeAudio: fakeMetronomeAudio,
      });
      expect(() => metronomeEngine.generateMetronomeGuide({ durationMs: 1000 })).toThrow();
    });

    it("throws when no metronome audio source was configured", () => {
      engine.createProject("My Song");
      expect(() => engine.generateMetronomeGuide({ durationMs: 1000 })).toThrow();
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

    it("includes the Guide in composite playback as a muted entry by default (excluded from Mixdown)", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      await engine.recordTake(undefined);
      await engine.stopRecording();

      await engine.play();

      const schedule = playback.playedSchedules[playback.playedSchedules.length - 1];
      const guideEntry = schedule.entries.find((e) => e.takeId === "guide");
      expect(guideEntry?.muted).toBe(true);
    });

    it("excludes the Guide from the Monitor Mix when includeInMonitorMix is turned off", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      engine.setGuideIncludeInMonitorMix(false);

      await engine.recordTake(undefined);

      expect(playback.playedSchedules).toHaveLength(0);
    });

    it("includes the Guide, unmuted, in composite playback once includeInMixdown is turned on", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      await engine.recordTake(undefined);
      await engine.stopRecording();

      engine.setGuideIncludeInMixdown(true);
      await engine.play();

      const schedule = playback.playedSchedules[playback.playedSchedules.length - 1];
      const guideEntry = schedule.entries.find((e) => e.takeId === "guide");
      expect(guideEntry?.muted).toBe(false);
    });

    it("pushes a live mix update for the Guide when includeInMixdown changes while already playing", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      await engine.recordTake(undefined);
      await engine.stopRecording();
      await engine.play();

      engine.setGuideIncludeInMixdown(true);

      expect(playback.mixUpdates).toHaveLength(1);
      const { updates } = playback.mixUpdates[0];
      expect(updates.find((u) => u.takeId === "guide")).toEqual({
        takeId: "guide",
        volume: 1,
        muted: false,
      });
    });

    it("throws when toggling Guide flags with no Guide imported", () => {
      engine.createProject("My Song");
      expect(() => engine.setGuideIncludeInMonitorMix(true)).toThrow();
      expect(() => engine.setGuideIncludeInMixdown(true)).toThrow();
    });
  });

  describe("tempo and time signature", () => {
    it("gives a new Project the default tempo and time signature", () => {
      engine.createProject("My Song");
      const project = engine.getActiveProject()!;
      expect(project.tempoBpm).toBe(DEFAULT_TEMPO_BPM);
      expect(project.beatsPerBar).toBe(DEFAULT_BEATS_PER_BAR);
    });

    it("creates a Project at the given tempo and time signature", () => {
      engine.createProject("My Song", { bpm: 120, beatsPerBar: 3 });
      const project = engine.getActiveProject()!;
      expect(project.tempoBpm).toBe(120);
      expect(project.beatsPerBar).toBe(3);
    });

    it("defaults whichever of the two is omitted at creation", () => {
      engine.createProject("My Song", { bpm: 120 });
      const project = engine.getActiveProject()!;
      expect(project.tempoBpm).toBe(120);
      expect(project.beatsPerBar).toBe(DEFAULT_BEATS_PER_BAR);
    });

    it("rejects a non-positive tempo or time signature at creation", () => {
      expect(() => engine.createProject("My Song", { bpm: 0 })).toThrow();
      expect(() => engine.createProject("My Song", { beatsPerBar: 0 })).toThrow();
      expect(engine.getActiveProject()).toBeNull();
    });
  });

  describe("exportSnapshot / loadSnapshot", () => {
    it("round-trips the Project's tempo and time signature", () => {
      engine.createProject("My Song", { bpm: 120, beatsPerBar: 3 });

      const freshEngine = new RecordingEngine(new FakeCaptureAdapter(), new FakePlaybackAdapter(), NO_LEAD_IN);
      freshEngine.loadSnapshot(engine.exportSnapshot());

      expect(freshEngine.getActiveProject()!.tempoBpm).toBe(120);
      expect(freshEngine.getActiveProject()!.beatsPerBar).toBe(3);
    });

    it("defaults tempo and time signature when loading a snapshot saved before they existed", () => {
      engine.createProject("My Song");
      const { tempoBpm, beatsPerBar, ...legacy } = engine.exportSnapshot();

      const freshEngine = new RecordingEngine(new FakeCaptureAdapter(), new FakePlaybackAdapter(), NO_LEAD_IN);
      freshEngine.loadSnapshot(legacy);

      expect(freshEngine.getActiveProject()!.tempoBpm).toBe(DEFAULT_TEMPO_BPM);
      expect(freshEngine.getActiveProject()!.beatsPerBar).toBe(DEFAULT_BEATS_PER_BAR);
    });

    it("falls back to the defaults for a snapshot carrying a non-positive tempo", () => {
      engine.createProject("My Song");
      const snapshot = { ...engine.exportSnapshot(), tempoBpm: 0, beatsPerBar: -1 };

      const freshEngine = new RecordingEngine(new FakeCaptureAdapter(), new FakePlaybackAdapter(), NO_LEAD_IN);
      freshEngine.loadSnapshot(snapshot);

      expect(freshEngine.getActiveProject()!.tempoBpm).toBe(DEFAULT_TEMPO_BPM);
      expect(freshEngine.getActiveProject()!.beatsPerBar).toBe(DEFAULT_BEATS_PER_BAR);
    });

    it("round-trips a Project's Tracks, Takes, Guide, and Monitor Mix levels", async () => {
      engine.createProject("My Song");
      engine.importGuide("guide-media-ref");
      engine.setMonitorMixLevel("guide", 0.5);
      await engine.recordTake(undefined);
      await engine.stopRecording();
      const trackId = engine.getActiveProject()!.tracks[0].id;
      engine.setMonitorMixLevel(trackId, 0.8);

      const snapshot = engine.exportSnapshot();

      const freshEngine = new RecordingEngine(new FakeCaptureAdapter(), new FakePlaybackAdapter(), NO_LEAD_IN);
      freshEngine.loadSnapshot(snapshot);

      const project = freshEngine.getActiveProject()!;
      expect(project.id).toBe(snapshot.id);
      expect(project.name).toBe("My Song");
      expect(project.tracks).toEqual(engine.getActiveProject()!.tracks);
      expect(project.guide).toEqual(engine.getActiveProject()!.guide);
      expect(freshEngine.getMonitorMixLevel("guide")).toBe(0.5);
      expect(freshEngine.getMonitorMixLevel(trackId)).toBe(0.8);
    });

    it("throws when loading a snapshot while recording or playing", async () => {
      engine.createProject("My Song");
      const snapshot = engine.exportSnapshot();
      await engine.recordTake(undefined);

      expect(() => engine.loadSnapshot(snapshot)).toThrow();
    });
  });
});
