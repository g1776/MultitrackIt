import type { CaptureAdapter, CaptureHandle, PlaybackAdapter, PlaybackHandle } from "./adapters";
import type { EngineStatus, Guide, Project, Take, TakeId, Track, TrackId } from "./types";
import { buildCompositeSchedule, buildMixUpdates, buildMonitorMixSchedule } from "./scheduling";
import type { ProjectSnapshot } from "../persistence/types";

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
    this.project = { id: nextId("project"), name, createdAt: Date.now(), tracks: [], guide: null };
    return this.project;
  }

  /** Imports reference audio as the Project's Guide, replacing any existing one. */
  importGuide(mediaRef: string): Guide {
    const project = this.requireProject();
    const guide: Guide = { mediaRef, includeInMonitorMix: true, includeInMixdown: false };
    project.guide = guide;
    return guide;
  }

  /** Sets whether the Guide is audible in the Monitor Mix on the next recording. */
  setGuideIncludeInMonitorMix(include: boolean): void {
    const guide = this.requireGuide();
    guide.includeInMonitorMix = include;
  }

  /**
   * Sets whether the Guide is included in composite playback and exported
   * Mixdowns. Like mute/solo, the Guide is always present as a schedule
   * entry (muted or not) rather than added/removed, so this pushes a live
   * mix update to already-playing composite playback instead of restarting.
   */
  setGuideIncludeInMixdown(include: boolean): void {
    const project = this.requireProject();
    const guide = this.requireGuide();
    guide.includeInMixdown = include;

    if (this.status === "playing" && this.activePlaybackHandle) {
      this.playback.updateMix(
        this.activePlaybackHandle,
        buildMixUpdates(project.tracks, project.guide, this.monitorMix)
      );
    }
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

    // Monitor Mix: play back previously recorded Tracks' selected Takes,
    // offset-corrected and in sync, so the performer can record against
    // them. The Track being recorded onto is excluded.
    const monitorSchedule = buildMonitorMixSchedule(
      project.tracks,
      project.guide,
      this.monitorMix,
      track.id
    );

    // Started concurrently with capture, not after: capture.startCapture()
    // (camera/mic permission + MediaRecorder init) commonly takes real
    // wall-clock time on its own, which otherwise would've been the only
    // window the monitor Takes had to buffer before their scheduled
    // playback.play() start fires — sequencing them let capture setup eat
    // that entire buffering window, leaving audio at the start of a Take
    // audibly late/stuttering until it caught up.
    const [captureHandle, monitorHandle] = await Promise.all([
      this.capture.startCapture(),
      monitorSchedule.entries.length > 0 ? this.playback.play(monitorSchedule) : Promise.resolve(null),
    ]);
    this.activeCaptureHandle = captureHandle;
    this.activeMonitorPlaybackHandle = monitorHandle;

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
    const latencyMs = this.capture.getLatencyMs?.();
    const take: Take = {
      id: nextId("take"),
      trackId,
      mediaRef,
      // Negated: a Take recorded against Monitor Mix output that arrived
      // `latencyMs` late needs to start that much earlier to line back up.
      offsetMs: latencyMs ? -latencyMs : 0,
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
      const schedule = buildCompositeSchedule(project.tracks, project.guide, this.monitorMix);
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
        buildMixUpdates(project.tracks, project.guide, this.monitorMix)
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
    const schedule = buildCompositeSchedule(project.tracks, project.guide, this.monitorMix);

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

  /** Serializes the active Project's full state (Tracks, Takes, Guide, Monitor Mix) for persistence. */
  exportSnapshot(): ProjectSnapshot {
    const project = this.requireProject();
    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      tracks: project.tracks,
      guide: project.guide,
      monitorMix: Array.from(this.monitorMix.entries()).map(([targetId, level]) => ({
        targetId,
        level,
      })),
    };
  }

  /**
   * Restores a previously exported Project snapshot as the active Project.
   * Requires the caller (idle) — cannot be loaded mid-recording/playback.
   */
  loadSnapshot(snapshot: ProjectSnapshot): void {
    if (this.status !== "idle") {
      throw new Error(`Cannot load a Project while ${this.status}`);
    }
    this.project = {
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      tracks: snapshot.tracks,
      guide: snapshot.guide,
    };
    this.monitorMix = new Map(snapshot.monitorMix.map((m) => [m.targetId, m.level]));
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

  private requireGuide(): Guide {
    const guide = this.requireProject().guide;
    if (!guide) throw new Error("No Guide imported");
    return guide;
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
