import type { CaptureAdapter, CaptureHandle, PlaybackAdapter, PlaybackHandle } from "./adapters";
import type { EngineStatus, Project, Take, TakeId, Track, TrackId } from "./types";

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

  constructor(
    private readonly capture: CaptureAdapter,
    private readonly playback: PlaybackAdapter
  ) {}

  createProject(name: string): Project {
    this.project = { name, tracks: [] };
    return this.project;
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
    this.status = "recording";
  }

  async stopRecording(): Promise<void> {
    if (this.status !== "recording" || !this.activeCaptureHandle || !this.activeCaptureTrackId) {
      throw new Error("Not currently recording");
    }
    const trackId = this.activeCaptureTrackId;
    const mediaRef = await this.capture.stopCapture(this.activeCaptureHandle);

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

  selectTake(trackId: TrackId, takeId: TakeId): void {
    const track = this.requireTrack(trackId);
    if (!track.takes.some((t) => t.id === takeId)) {
      throw new Error(`Take ${takeId} not found on Track ${trackId}`);
    }
    track.selectedTakeId = takeId;
  }

  setTakeOffset(takeId: TakeId, offsetMs: number): void {
    const take = this.findTake(takeId);
    take.offsetMs = offsetMs;
  }

  setTrackMuteSolo(trackId: TrackId, changes: { mute?: boolean; solo?: boolean }): void {
    const track = this.requireTrack(trackId);
    if (changes.mute !== undefined) track.mute = changes.mute;
    if (changes.solo !== undefined) track.solo = changes.solo;
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
    const soloedTracks = project.tracks.filter((t) => t.solo);
    const audibleTracks = soloedTracks.length > 0 ? soloedTracks : project.tracks;

    const entries = audibleTracks
      .filter((track) => !track.mute && track.selectedTakeId)
      .map((track) => {
        const take = track.takes.find((t) => t.id === track.selectedTakeId)!;
        return {
          takeId: take.id,
          mediaRef: take.mediaRef,
          startAtMs: take.offsetMs,
          volume: this.monitorMix.get(track.id) ?? 1,
          muted: false,
        };
      });

    this.activePlaybackHandle = await this.playback.play({ entries });
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
