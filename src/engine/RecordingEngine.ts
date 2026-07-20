import type { CaptureAdapter, CaptureHandle, PlaybackAdapter, PlaybackHandle } from "./adapters";
import type { EngineStatus, Guide, Project, Take, TakeId, Track, TrackId } from "./types";
import { buildCompositeSchedule, buildMixUpdates, buildMonitorMixSchedule } from "./scheduling";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Owns Project/Track/Take/Guide state, the Monitor Mix, and playback sync.
 * Depends only on the capture/playback adapter interfaces, never on
 * Electron/OS AV APIs directly.
 */
export class RecordingEngine {
  private project: Project | null = null;
  private status: EngineStatus = "idle";
  private monitorMix = new Map<TrackId | "guide", number>();
  private activeCaptureHandle: CaptureHandle | null = null;
  private activeCaptureTrackId: TrackId | null = null;
  private activePlaybackHandle: PlaybackHandle | null = null;
  private activeMonitorPlaybackHandle: PlaybackHandle | null = null;

  constructor(
    private readonly capture: CaptureAdapter,
    private readonly playback: PlaybackAdapter
  ) {}

  createProject(name: string): Project {
    this.project = { name, tracks: [], guide: null };
    return this.project;
  }

  /** Imports reference audio as the Project's Guide, replacing any existing one. */
  importGuide(mediaRef: string): Guide {
    const project = this.requireProject();
    const guide: Guide = { mediaRef };
    project.guide = guide;
    return guide;
  }

  getActiveProject(): Project | null {
    return this.project;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async recordTake(trackId: TrackId | undefined): Promise<void> {
    if (this.status !== "idle") {
      throw new Error(`Cannot start recording while ${this.status}`);
    }
    const project = this.requireProject();
    const track = trackId
      ? this.requireTrack(trackId)
      : this.createTrack(project);

    this.activeCaptureTrackId = track.id;
    this.activeCaptureHandle = await this.capture.startCapture();

    // Monitor Mix: play back previously recorded Tracks' selected Takes,
    // offset-corrected and in sync, so the performer can record against
    // them. The Track being recorded onto is excluded.
    const monitorSchedule = buildMonitorMixSchedule(
      project.tracks,
      project.guide,
      this.monitorMix,
      track.id
    );
    if (monitorSchedule.entries.length > 0) {
      this.activeMonitorPlaybackHandle = await this.playback.play(monitorSchedule);
    }

    this.status = "recording";
  }

  async stopRecording(): Promise<void> {
    if (this.status !== "recording" || !this.activeCaptureHandle || !this.activeCaptureTrackId) {
      throw new Error("Not currently recording");
    }
    const trackId = this.activeCaptureTrackId;
    const mediaRef = await this.capture.stopCapture(this.activeCaptureHandle);

    if (this.activeMonitorPlaybackHandle) {
      await this.playback.stop(this.activeMonitorPlaybackHandle);
      this.activeMonitorPlaybackHandle = null;
    }

    const track = this.requireTrack(trackId);
    const take: Take = {
      id: nextId("take"),
      trackId,
      mediaRef,
      offsetMs: 0,
      createdAt: Date.now(),
    };
    track.takes.push(take);
    track.selectedTakeId = take.id;

    this.activeCaptureHandle = null;
    this.activeCaptureTrackId = null;
    this.status = "idle";
  }

  renameTrack(trackId: TrackId, name: string): void {
    const track = this.requireTrack(trackId);
    track.name = name;
  }

  selectTake(trackId: TrackId, takeId: TakeId): void {
    const track = this.requireTrack(trackId);
    if (!track.takes.some((t) => t.id === takeId)) {
      throw new Error(`Take ${takeId} not found on Track ${trackId}`);
    }
    track.selectedTakeId = takeId;
  }

  /**
   * Updates a Take's Offset. Unlike mute/solo (a live volume-only update via
   * `updateMix`), an Offset change alters *when* a Take starts, which the
   * PlaybackAdapter seam has no way to apply to an already-playing entry —
   * so if composite playback is in progress, it's restarted with a freshly
   * computed schedule to bring the new Offset into effect immediately.
   */
  async setTakeOffset(takeId: TakeId, offsetMs: number): Promise<void> {
    const take = this.findTake(takeId);
    take.offsetMs = offsetMs;

    if (this.status === "playing" && this.activePlaybackHandle) {
      const project = this.requireProject();
      await this.playback.stop(this.activePlaybackHandle);
      const schedule = buildCompositeSchedule(project.tracks, this.monitorMix);
      this.activePlaybackHandle = await this.playback.play(schedule);
    }
  }

  setTrackMuteSolo(trackId: TrackId, changes: { mute?: boolean; solo?: boolean }): void {
    const track = this.requireTrack(trackId);
    if (changes.mute !== undefined) track.mute = changes.mute;
    if (changes.solo !== undefined) track.solo = changes.solo;

    if (this.status === "playing" && this.activePlaybackHandle) {
      const project = this.requireProject();
      this.playback.updateMix(
        this.activePlaybackHandle,
        buildMixUpdates(project.tracks, this.monitorMix)
      );
    }
  }

  setMonitorMixLevel(targetId: TrackId | "guide", level: number): void {
    this.monitorMix.set(targetId, level);
  }

  getMonitorMixLevel(targetId: TrackId | "guide"): number | undefined {
    return this.monitorMix.get(targetId);
  }

  async play(): Promise<void> {
    if (this.status !== "idle") {
      throw new Error(`Cannot start playback while ${this.status}`);
    }
    const project = this.requireProject();
    const schedule = buildCompositeSchedule(project.tracks, this.monitorMix);

    this.activePlaybackHandle = await this.playback.play(schedule);
    this.status = "playing";
  }

  async stop(): Promise<void> {
    if (this.activePlaybackHandle) {
      await this.playback.stop(this.activePlaybackHandle);
      this.activePlaybackHandle = null;
    }
    this.status = "idle";
  }

  private createTrack(project: Project): Track {
    const track: Track = {
      id: nextId("track"),
      name: `Track ${project.tracks.length + 1}`,
      takes: [],
      selectedTakeId: null,
      mute: false,
      solo: false,
    };
    project.tracks.push(track);
    return track;
  }

  private requireProject(): Project {
    if (!this.project) throw new Error("No active Project");
    return this.project;
  }

  private requireTrack(trackId: TrackId): Track {
    const track = this.requireProject().tracks.find((t) => t.id === trackId);
    if (!track) throw new Error(`Track ${trackId} not found`);
    return track;
  }

  private findTake(takeId: TakeId): Take {
    for (const track of this.requireProject().tracks) {
      const take = track.takes.find((t) => t.id === takeId);
      if (take) return take;
    }
    throw new Error(`Take ${takeId} not found`);
  }
}
