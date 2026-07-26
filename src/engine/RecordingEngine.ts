import type {
  CaptureAdapter,
  CaptureHandle,
  CountInAdapter,
  PlaybackAdapter,
  PlaybackHandle,
} from "./adapters";
import type { EngineStatus, Guide, Project, Take, TakeId, Track, TrackId } from "./types";
import { buildCompositeSchedule, buildMixUpdates, buildMonitorMixSchedule } from "./scheduling";
import { computeCountIn, type CountInPlan } from "./countIn";
import type { ProjectSnapshot } from "../persistence/types";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Bars counted in before capture begins, by default — one, which is what a
 * performer expects unless told otherwise. Bars, not milliseconds: the
 * Count-in's duration follows from the Project's tempo and time signature
 * (see `computeCountIn`, ADR 0003).
 */
export const DEFAULT_COUNT_IN_BARS = 1;

/**
 * Fixed silent interval (ms) before the Count-in, giving the shared playback
 * clock time to prime so the first counted beat is accurate. Applied at every
 * tempo, so the gap between starting a recording and that first beat is
 * constant and learnable. Provisional: ADR 0003 adopted 1000ms as a guess to
 * be corrected from the measurements ADR 0004's harness records, not as a
 * figure derived from anything.
 */
export const DEFAULT_COUNT_IN_PADDING_MS = 1000;

/** Count-in click source used when none is supplied — silent, for tests and headless use. */
const SILENT_COUNT_IN: CountInAdapter = {
  playCountIn: async () => {},
  cancel: () => {},
};

export interface RecordingEngineOptions {
  /** Dedicated Count-in click source. Defaults to a silent one. */
  countIn?: CountInAdapter;
  /** Whole bars to count in for. Defaults to `DEFAULT_COUNT_IN_BARS`. */
  countInBars?: number;
  /** Count-in Padding in ms. Defaults to `DEFAULT_COUNT_IN_PADDING_MS`. */
  countInPaddingMs?: number;
}

/** Tempo a new Project starts at, and the fallback for snapshots saved before Projects owned a tempo. */
export const DEFAULT_TEMPO_BPM = 100;

/** Time signature a new Project starts at (4/4), and the fallback for pre-tempo snapshots. */
export const DEFAULT_BEATS_PER_BAR = 4;

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
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
  private statusListeners = new Set<(status: EngineStatus) => void>();
  private readonly countIn: CountInAdapter;
  private readonly countInBars: number;
  private readonly countInPaddingMs: number;

  constructor(
    private readonly capture: CaptureAdapter,
    private readonly playback: PlaybackAdapter,
    options: RecordingEngineOptions = {}
  ) {
    this.countIn = options.countIn ?? SILENT_COUNT_IN;
    this.countInBars = options.countInBars ?? DEFAULT_COUNT_IN_BARS;
    this.countInPaddingMs = options.countInPaddingMs ?? DEFAULT_COUNT_IN_PADDING_MS;
  }

  /**
   * Creates a Project at a fixed tempo and time signature (defaulting to
   * 100bpm, 4/4). Both are settable only here: they are read-only for the
   * Project's lifetime, so anything already recorded against them — Takes,
   * and a metronome Guide generated from them — can never be invalidated by
   * a later change. Re-tempoing an existing Project is a separate problem,
   * not yet modelled.
   */
  createProject(name: string, tempo: { bpm?: number; beatsPerBar?: number } = {}): Project {
    if (tempo.bpm !== undefined && !(tempo.bpm > 0)) throw new Error("bpm must be positive");
    if (tempo.beatsPerBar !== undefined && !(tempo.beatsPerBar > 0)) {
      throw new Error("beatsPerBar must be positive");
    }
    this.project = {
      id: nextId("project"),
      name,
      createdAt: Date.now(),
      tracks: [],
      guide: null,
      tempoBpm: tempo.bpm ?? DEFAULT_TEMPO_BPM,
      beatsPerBar: tempo.beatsPerBar ?? DEFAULT_BEATS_PER_BAR,
    };
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

  /**
   * Subscribes to status changes, returning an unsubscribe function. The
   * lead-in passes through `getting-ready` and `counting-in` inside a single
   * awaited `recordTake` call, so a UI that only sees that call resolve
   * cannot tell the two phases apart — this is how it observes them.
   */
  onStatusChange(listener: (status: EngineStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  /**
   * The lead-in the next recording will use, derived from the active
   * Project's tempo and time signature — for a caller rendering the visible
   * Count-in, so the beats it displays are the same ones the engine sounds
   * and times capture against rather than a parallel calculation.
   */
  getCountInPlan(): CountInPlan {
    const project = this.requireProject();
    return computeCountIn({
      bpm: project.tempoBpm,
      beatsPerBar: project.beatsPerBar,
      bars: this.countInBars,
      paddingMs: this.countInPaddingMs,
    });
  }

  /** The handle for in-progress composite playback, if any — for a caller syncing its own UI (e.g. the video grid) to the same audio graph. */
  getActivePlaybackHandle(): PlaybackHandle | null {
    return this.activePlaybackHandle;
  }

  /** The handle for the in-progress Monitor Mix playback during recording, if any — see `getActivePlaybackHandle`. */
  getActiveMonitorPlaybackHandle(): PlaybackHandle | null {
    return this.activeMonitorPlaybackHandle;
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
    const plan = this.getCountInPlan();

    // Monitor Mix: play back previously recorded Tracks' selected Takes,
    // offset-corrected and in sync, so the performer can record against
    // them. The Track being recorded onto is excluded. The whole mix is
    // scheduled to *begin at capture start* (`leadInMs`), because that is
    // the Project timeline's zero point — so a Guide of a given length
    // offers that entire length to record against, none of it spent on the
    // lead-in. Handed to the playback adapter now rather than when the
    // lead-in ends, so the shared clock primes silently during the padding
    // and the Count-in's first beat lands accurately (see Project timeline
    // and Count-in Padding, `CONTEXT.md`, ADR 0003).
    const monitorSchedule = buildMonitorMixSchedule(
      project.tracks,
      project.guide,
      this.monitorMix,
      track.id,
      plan.leadInMs
    );
    if (monitorSchedule.entries.length > 0) {
      this.activeMonitorPlaybackHandle = await this.playback.play(monitorSchedule);
    }

    // Get ready (silent), then count in (audible), then capture. The clicks
    // come from their own source, never from the Guide, which has not begun
    // sounding yet at this point.
    this.setStatus("getting-ready");
    await this.wait(plan.paddingMs);

    this.setStatus("counting-in");
    if (plan.clicks.length > 0) await this.countIn.playCountIn(plan.clicks);
    await this.wait(plan.countInMs);

    try {
      this.activeCaptureHandle = await this.capture.startCapture();
    } catch (e) {
      await this.abandonRecording();
      throw e;
    }
    this.setStatus("recording");
  }

  /** Tears down a recording that never reached `recording`, leaving the engine idle. */
  private async abandonRecording(): Promise<void> {
    this.countIn.cancel();
    if (this.activeMonitorPlaybackHandle) {
      await this.playback.stop(this.activeMonitorPlaybackHandle);
      this.activeMonitorPlaybackHandle = null;
    }
    this.activeCaptureTrackId = null;
    this.setStatus("idle");
  }

  /** Resolves after `ms`, or immediately for `ms <= 0` — lets tests skip the real lead-in delay. */
  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    // Latency correction, and nothing else: this Take's own t=0 is capture
    // start, which is also the Project timeline's zero point, so nothing
    // about the lead-in enters here (see Offset, `CONTEXT.md`, ADR 0003).
    // Negated: a Take recorded against Monitor Mix output that arrived
    // `latencyMs` late needs to start that much earlier to line back up.
    // Written as a conditional rather than `-(latencyMs ?? 0)` so an absent
    // estimate stores 0, not -0.
    const take: Take = {
      id: nextId("take"),
      trackId,
      mediaRef,
      offsetMs: latencyMs ? -latencyMs : 0,
      createdAt: Date.now(),
    };
    track.takes.push(take);
    track.selectedTakeId = take.id;

    this.activeCaptureHandle = null;
    this.activeCaptureTrackId = null;
    this.setStatus("idle");
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
    this.setStatus("playing");
  }

  async stop(): Promise<void> {
    if (this.activePlaybackHandle) {
      await this.playback.stop(this.activePlaybackHandle);
      this.activePlaybackHandle = null;
    }
    this.setStatus("idle");
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
      tempoBpm: project.tempoBpm,
      beatsPerBar: project.beatsPerBar,
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
      // Snapshots predating Project-owned tempo carry neither field, and a
      // hand-edited one could carry a nonsensical value; both fall back to
      // the defaults rather than loading a Project that violates the same
      // invariant `setTempo` enforces.
      tempoBpm: positiveOr(snapshot.tempoBpm, DEFAULT_TEMPO_BPM),
      beatsPerBar: positiveOr(snapshot.beatsPerBar, DEFAULT_BEATS_PER_BAR),
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
