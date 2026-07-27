import type {
  CaptureAdapter,
  CaptureHandle,
  CountInAdapter,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackSchedule,
} from "./adapters";
import type {
  EngineEventSink,
  PlaybackPurpose,
  ScheduledEntryRecord,
} from "./events";
import type { EngineStatus, Guide, Project, Take, TakeId, Track, TrackId } from "./types";
import { buildCompositeSchedule, buildMixUpdates, buildMonitorMixSchedule } from "./scheduling";
import { computeCountIn, type CountInPlan } from "./countIn";
import { computeMetronomeClicks, type MetronomeParams } from "./metronome";
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

/**
 * How long (ms) an armed-but-idle capture device is held open before being
 * released automatically (ADR 0005's "disarm on idle, not on stop"). Long
 * enough that ordinary retake pacing never pays for reacquisition, short
 * enough that a performer who has stepped away isn't left with a hot mic and
 * camera indefinitely. 0 or below disables idle release entirely.
 */
export const DEFAULT_IDLE_RELEASE_MS = 30000;

/** Count-in click source used when none is supplied — silent, for tests and headless use. */
const SILENT_COUNT_IN: CountInAdapter = {
  playCountIn: async () => {},
  cancel: () => {},
};

/**
 * Renders a Metronome's audio from its tempo/time-signature/duration,
 * returning an opaque mediaRef — the browser-specific synthesis step
 * (`generateMetronomeGuideAudio`) injected here rather than imported
 * directly, so the engine still depends only on adapter seams, never
 * Electron/browser AV APIs (matching `CaptureAdapter`/`PlaybackAdapter`).
 */
export type MetronomeAudioSource = (params: MetronomeParams) => string;

const NO_METRONOME_AUDIO: MetronomeAudioSource = () => {
  throw new Error("No metronome audio source configured");
};

export interface RecordingEngineOptions {
  /** Dedicated Count-in click source. Defaults to a silent one. */
  countIn?: CountInAdapter;
  /** Whole bars to count in for. Defaults to `DEFAULT_COUNT_IN_BARS`. */
  countInBars?: number;
  /** Count-in Padding in ms. Defaults to `DEFAULT_COUNT_IN_PADDING_MS`. */
  countInPaddingMs?: number;
  /** Idle-release delay in ms. Defaults to `DEFAULT_IDLE_RELEASE_MS`. */
  idleReleaseMs?: number;
  /**
   * Optional observer of lifecycle events, for diagnostics. Absent during
   * normal operation, and nothing about the engine's behaviour depends on
   * whether one is present.
   */
  events?: EngineEventSink;
  /**
   * Metronome audio synthesis, used by `generateMetronomeGuide`. Absent by
   * default — only a caller that actually generates Metronome Guides needs
   * to supply one; calling `generateMetronomeGuide` without one throws.
   */
  metronomeAudio?: MetronomeAudioSource;
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
  private armed = false;
  private armedListeners = new Set<(armed: boolean) => void>();
  /** The in-flight `arm()` attempt, if any — lets concurrent callers (e.g. a double-click) join it instead of racing a second acquisition. */
  private armingPromise: Promise<void> | null = null;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly countIn: CountInAdapter;
  private readonly countInBars: number;
  private readonly countInPaddingMs: number;
  private readonly idleReleaseMs: number;
  private readonly events: EngineEventSink | undefined;
  private readonly metronomeAudio: MetronomeAudioSource;

  constructor(
    private readonly capture: CaptureAdapter,
    private readonly playback: PlaybackAdapter,
    options: RecordingEngineOptions = {}
  ) {
    this.countIn = options.countIn ?? SILENT_COUNT_IN;
    this.countInBars = options.countInBars ?? DEFAULT_COUNT_IN_BARS;
    this.countInPaddingMs = options.countInPaddingMs ?? DEFAULT_COUNT_IN_PADDING_MS;
    this.idleReleaseMs = options.idleReleaseMs ?? DEFAULT_IDLE_RELEASE_MS;
    this.events = options.events;
    this.metronomeAudio = options.metronomeAudio ?? NO_METRONOME_AUDIO;
  }

  /**
   * Starts playback of `schedule`, reporting to the event sink both the
   * schedule that was built and the playback that followed. The one place
   * playback begins, so a diagnostics timeline can't come to be missing a
   * pass simply because a new call site forgot to report itself.
   *
   * Each entry's computed `startAtMs` is paired with the Take Offset it came
   * from here rather than carried on `PlaybackScheduleEntry`, so the playback
   * seam stays about what to play and when, not about where the when came from.
   */
  private async startPlayback(
    purpose: PlaybackPurpose,
    schedule: PlaybackSchedule
  ): Promise<PlaybackHandle> {
    this.recordSchedule(purpose, schedule);
    const handle = await this.playback.play(schedule);
    this.events?.record({ type: "playback-started", purpose });
    return handle;
  }

  /**
   * Reports a built schedule to the event sink without playing it — for the
   * one case where a schedule exists but nothing sounds (an empty Monitor
   * Mix). The empty schedule is still stated: "nothing was monitored" is a
   * fact about the pass, and an absent event would read as a gap.
   */
  private recordSchedule(purpose: PlaybackPurpose, schedule: PlaybackSchedule): void {
    if (!this.events) return;
    const entries: ScheduledEntryRecord[] = schedule.entries.map((entry) => ({
      takeId: entry.takeId,
      startAtMs: entry.startAtMs,
      offsetMs: entry.takeId === "guide" ? 0 : this.findTakeOrNull(entry.takeId)?.offsetMs ?? null,
    }));
    this.events.record({ type: "schedule-built", purpose, entries });
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

  /**
   * Generates a Metronome — a click track at the Project's own tempo and
   * time signature — and imports it as the Project's Guide, replacing any
   * existing one, exactly as `importGuide` does (audible in Monitor Mix by
   * default, excluded from Mixdown by default). The tempo/time signature are
   * read from the Project rather than passed in: they are fixed for a
   * Project's lifetime (see `createProject`), so a Metronome generated from
   * them can never disagree with what Takes were actually recorded against.
   * The click schedule it was rendered from is attached to the returned
   * Guide as `metronomeSchedule`.
   */
  generateMetronomeGuide(params: { durationMs: number }): Guide {
    const project = this.requireProject();
    const metronomeParams: MetronomeParams = {
      bpm: project.tempoBpm,
      beatsPerBar: project.beatsPerBar,
      durationMs: params.durationMs,
    };
    const mediaRef = this.metronomeAudio(metronomeParams);
    const guide = this.importGuide(mediaRef);
    guide.metronomeSchedule = computeMetronomeClicks(metronomeParams);
    return guide;
  }

  /**
   * Attaches an existing Guide — typically one generated by another
   * `RecordingEngine` instance — as this Project's Guide, replacing any
   * existing one, exactly as `importGuide`/`generateMetronomeGuide` do. A
   * defensive clone, not the same object: two engines built for
   * `runFullDiagnosticsSuite`'s Mode B and Mode A legs share one Metronome's
   * beat grid (ADR 0006), but each still owns its own Guide flags, so
   * toggling one can never mutate the other's.
   */
  attachGuide(guide: Guide): Guide {
    const project = this.requireProject();
    const cloned: Guide = {
      ...guide,
      metronomeSchedule: guide.metronomeSchedule ? [...guide.metronomeSchedule] : undefined,
    };
    project.guide = cloned;
    return cloned;
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

  /** Whether the capture device is currently armed (held open) — see `arm()`. */
  isArmed(): boolean {
    return this.armed;
  }

  /**
   * Subscribes to armed-state changes, returning an unsubscribe function.
   * Kept separate from `onStatusChange`: armed is a persistent state of the
   * device that outlives any one Take, not a phase of a single `recordTake`
   * call the way `arming`/`getting-ready`/`counting-in` are.
   */
  onArmedChange(listener: (armed: boolean) => void): () => void {
    this.armedListeners.add(listener);
    return () => this.armedListeners.delete(listener);
  }

  private setArmed(armed: boolean): void {
    this.armed = armed;
    for (const listener of this.armedListeners) listener(armed);
  }

  /**
   * Acquires and holds the capture device open, explicitly and ahead of any
   * particular Take (ADR 0005: "holding is an action, not a preference").
   * A no-op if already armed. `recordTake` calls this itself when needed, so
   * a performer who never arms explicitly still gets a correct — if less
   * predictable — lead-in; arming ahead of time is what makes retakes and
   * the wait itself visible rather than incidental.
   */
  async arm(): Promise<void> {
    if (this.armed) {
      this.scheduleIdleRelease();
      return;
    }
    if (this.armingPromise) {
      await this.armingPromise;
      this.scheduleIdleRelease();
      return;
    }
    if (this.status !== "idle") {
      throw new Error(`Cannot arm while ${this.status}`);
    }
    try {
      await this.doArm();
    } finally {
      this.setStatus("idle");
    }
    this.scheduleIdleRelease();
  }

  /**
   * The raw arm attempt, shared by `arm()` and `recordTake`. Leaves status
   * management to the caller: `arm()` returns it to `idle` once done,
   * `recordTake` instead carries straight on into the lead-in so the
   * observed status sequence is `arming` → `getting-ready`, with no
   * intervening `idle` flicker between an unarmed Take's arm and its lead-in.
   */
  private async doArm(): Promise<void> {
    this.setStatus("arming");
    this.events?.record({ type: "arming-started" });
    const promise = this.capture
      .arm()
      .then(() => {
        this.setArmed(true);
        this.events?.record({ type: "armed" });
      })
      .catch((e) => {
        this.events?.record({ type: "arming-failed", message: (e as Error).message });
        throw e;
      });
    this.armingPromise = promise;
    try {
      await promise;
    } finally {
      this.armingPromise = null;
    }
  }

  /**
   * Releases the capture device. A no-op if not armed. Also called
   * automatically after `idleReleaseMs` of no recording activity — see
   * `scheduleIdleRelease`.
   */
  async disarm(): Promise<void> {
    this.clearIdleReleaseTimer();
    if (!this.armed) return;
    if (this.status !== "idle") {
      throw new Error(`Cannot disarm while ${this.status}`);
    }
    await this.capture.disarm();
    this.setArmed(false);
    this.events?.record({ type: "disarmed" });
  }

  /**
   * (Re)starts the idle-release countdown. Called whenever the device
   * becomes armed-and-idle — after `arm()` completes standalone, after a
   * Take, or after an abandoned recording — and cancelled by
   * `clearIdleReleaseTimer` the moment the device is put back to use, so a
   * Take in progress can never be disarmed out from under it.
   */
  private scheduleIdleRelease(): void {
    this.clearIdleReleaseTimer();
    if (this.idleReleaseMs <= 0) return;
    this.idleReleaseTimer = setTimeout(() => {
      this.idleReleaseTimer = null;
      void this.disarm().catch(() => {
        // Best-effort: if the device is busy again by the time this fires
        // (e.g. a recording started right as the timer expired), disarm()'s
        // own guard rejects and there is nothing useful to do about it here.
      });
    }, this.idleReleaseMs);
  }

  private clearIdleReleaseTimer(): void {
    if (this.idleReleaseTimer !== null) {
      clearTimeout(this.idleReleaseTimer);
      this.idleReleaseTimer = null;
    }
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

    // Arming completes before the lead-in begins (ADR 0005): device
    // acquisition varies by hundreds of milliseconds and must not land
    // inside the fixed padding/Count-in, so it happens here, ahead of
    // building the Monitor Mix schedule the padding is timed against. A
    // Track that is already armed skips straight through — retakes must not
    // pay this wait or lose the performer's gain staging.
    if (this.armed) {
      this.clearIdleReleaseTimer();
    } else {
      try {
        await this.doArm();
      } catch (e) {
        this.activeCaptureTrackId = null;
        this.setStatus("idle");
        throw e;
      }
    }

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
      plan.leadInMs,
      this.capture.getLatencyMs?.()
    );
    if (monitorSchedule.entries.length > 0) {
      this.activeMonitorPlaybackHandle = await this.startPlayback("monitor-mix", monitorSchedule);
    } else {
      this.recordSchedule("monitor-mix", monitorSchedule);
    }

    // Get ready (silent), then count in (audible), then capture. The clicks
    // come from their own source, never from the Guide, which has not begun
    // sounding yet at this point.
    this.setStatus("getting-ready");
    this.events?.record({ type: "padding-started", requestedDurationMs: plan.paddingMs });
    await this.wait(plan.paddingMs);
    this.events?.record({ type: "padding-ended" });

    this.setStatus("counting-in");
    this.events?.record({
      type: "count-in-started",
      requestedDurationMs: plan.countInMs,
      beats: plan.clicks.length,
      bars: this.countInBars,
    });
    if (plan.clicks.length > 0) await this.countIn.playCountIn(plan.clicks);
    await this.wait(plan.countInMs);
    this.events?.record({ type: "count-in-ended" });

    try {
      this.activeCaptureHandle = await this.capture.startCapture();
    } catch (e) {
      await this.abandonRecording();
      throw e;
    }
    this.events?.record({ type: "capture-started", trackId: track.id });
    this.setStatus("recording");
  }

  /** Tears down a recording that never reached `recording`, leaving the engine idle. */
  private async abandonRecording(): Promise<void> {
    this.countIn.cancel();
    await this.stopMonitorPlayback();
    this.activeCaptureTrackId = null;
    this.setStatus("idle");
    // Reached only after arming already succeeded (the MediaRecorder-start
    // step failed on an already-armed device), so the device is still
    // armed and idle-release applies exactly as it would after a Take.
    this.scheduleIdleRelease();
  }

  /** Stops Monitor Mix playback if any is in progress, leaving no active handle behind. */
  private async stopMonitorPlayback(): Promise<void> {
    if (!this.activeMonitorPlaybackHandle) return;
    await this.playback.stop(this.activeMonitorPlaybackHandle);
    this.activeMonitorPlaybackHandle = null;
    this.events?.record({ type: "playback-stopped", purpose: "monitor-mix" });
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
    await this.stopMonitorPlayback();

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
    this.events?.record({
      type: "capture-stopped",
      trackId,
      takeId: take.id,
      offsetMs: take.offsetMs,
    });

    this.activeCaptureHandle = null;
    this.activeCaptureTrackId = null;
    this.setStatus("idle");
    // Disarm on idle, not on stop (ADR 0005): the device stays held open so
    // a retake reuses this same acquisition, and is only released after
    // idleReleaseMs of nothing happening.
    this.scheduleIdleRelease();
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
      this.events?.record({ type: "playback-stopped", purpose: "composite" });
      const schedule = buildCompositeSchedule(project.tracks, project.guide, this.monitorMix);
      this.activePlaybackHandle = await this.startPlayback("composite", schedule);
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

    this.activePlaybackHandle = await this.startPlayback("composite", schedule);
    this.setStatus("playing");
  }

  async stop(): Promise<void> {
    if (this.activePlaybackHandle) {
      await this.playback.stop(this.activePlaybackHandle);
      this.activePlaybackHandle = null;
      this.events?.record({ type: "playback-stopped", purpose: "composite" });
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
    const take = this.findTakeOrNull(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);
    return take;
  }

  private findTakeOrNull(takeId: TakeId): Take | null {
    for (const track of this.project?.tracks ?? []) {
      const take = track.takes.find((t) => t.id === takeId);
      if (take) return take;
    }
    return null;
  }
}
