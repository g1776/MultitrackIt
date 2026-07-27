import type { MetronomeClick } from "./metronome";
import type { TakeId } from "./types";

/**
 * Seam between the recording engine and real OS-level AV I/O. The engine
 * depends only on these interfaces, never on Electron/browser AV APIs
 * directly, so it can be exercised in tests with fakes.
 *
 * Arming (acquiring the device and holding it open) is a distinct lifecycle
 * step from starting/stopping a Take's recording (ADR 0005): device
 * negotiation is not instantaneous and must not happen inside the recording
 * path, where its variance would land on the Project timeline's zero point.
 * `startCapture`/`stopCapture` operate on an already-armed device and deal
 * only in starting/stopping the recorder itself.
 */
export interface CaptureAdapter {
  /**
   * Acquires the capture device and resolves once it is actually delivering
   * media — a resolved `getUserMedia` promise alone is not enough, since a
   * camera can still be ramping exposure/gain at that point (ADR 0005).
   * Resolves immediately if already armed.
   */
  arm(): Promise<void>;
  /** Whether the device is currently held open by `arm()`. */
  isArmed(): boolean;
  /** Releases the held device. No-op if not armed. */
  disarm(): Promise<void>;
  /** Starts recording on an already-armed device. Returns a handle used to stop it. */
  startCapture(): Promise<CaptureHandle>;
  /** Stops recording and persists the result, returning an opaque media ref. Does not release the device. */
  stopCapture(handle: CaptureHandle): Promise<string>;
  /**
   * Estimated round-trip monitoring/recording latency (ms) for the capture
   * just stopped: the delay between Monitor Mix output and its arrival in
   * the captured input (e.g. from `AudioContext` output/input latency, or a
   * calibration tone measurement). Undefined when no estimate is available,
   * in which case no correction is applied.
   */
  getLatencyMs?(): number | undefined;
}

export interface CaptureHandle {
  id: string;
}

/**
 * Dedicated Count-in click source. Kept separate from the PlaybackAdapter
 * because the Count-in is not part of the Project timeline: its clicks
 * occupy negative time, are never recorded, and never come from the Guide
 * (which begins at t=0, when the Count-in ends — see Count-in, `CONTEXT.md`,
 * ADR 0003).
 */
export interface CountInAdapter {
  /**
   * Starts the given clicks playing now, resolving once they are scheduled
   * rather than once they have all sounded — the engine, not the adapter,
   * owns when the Count-in ends and capture begins.
   *
   * `startDelayMs`, when given, is milliseconds from now the *first* click
   * (`atMs: 0`) should sound, with every other click's `atMs` still relative
   * to that same moment — used to anchor the Count-in to the same instant
   * the Monitor Mix/Guide playback already started against (see
   * `PlaybackAdapter.getScheduledStartDelayMs`), rather than the Count-in
   * picking its own "now" after whatever imprecise wait preceded this call.
   */
  playCountIn(clicks: MetronomeClick[], startDelayMs?: number): Promise<void>;
  /** Stops any clicks still pending, e.g. if a recording is abandoned mid-Count-in. */
  cancel(): void;
}

export interface PlaybackSchedule {
  /** One entry per Take to play back, with its effective start time. */
  entries: PlaybackScheduleEntry[];
}

export interface PlaybackScheduleEntry {
  takeId: TakeId;
  mediaRef: string;
  /** Milliseconds from the start of playback that this Take should begin at. */
  startAtMs: number;
  volume: number;
  muted: boolean;
}

export interface PlaybackAdapter {
  play(schedule: PlaybackSchedule): Promise<PlaybackHandle>;
  stop(handle: PlaybackHandle): Promise<void>;
  /**
   * Applies new volume/muted values to Takes already playing under `handle`,
   * without restarting or re-syncing playback. Used so mute/solo takes
   * effect immediately on in-progress composite playback rather than only
   * on the next `play()`.
   */
  updateMix(handle: PlaybackHandle, updates: PlaybackMixUpdate[]): void;
  /**
   * Milliseconds from now a moment at `startAtMs` (same offset-normalized
   * units as a `PlaybackSchedule` entry) should occur, to land in sync with
   * this handle's already-scheduled audio graph — the one clock reference
   * every other caller anchors against instead of re-deriving its own
   * (originally built for the video grid; the Count-in uses it too, so its
   * clicks share the same anchor the Guide/Monitor Mix already committed to
   * rather than reading a fresh, possibly-drifted "now"). Undefined if
   * `handle` isn't (or is no longer) active, or if this adapter has no
   * shared clock to anchor against (e.g. a test fake).
   */
  getScheduledStartDelayMs?(handle: PlaybackHandle, startAtMs: number): number | undefined;
}

export interface PlaybackMixUpdate {
  takeId: TakeId;
  volume: number;
  muted: boolean;
}

export interface PlaybackHandle {
  id: string;
}

/**
 * A `PlaybackSchedule` translated into `AudioContext` clock terms: each
 * entry's start time and a shared video-anchor timestamp, all relative to
 * the same `AudioContext.currentTime` reference — the seam a real
 * `PlaybackAdapter` implementation uses to schedule a shared audio graph
 * instead of independent per-element timers (see ADR 0002).
 */
export interface AudioGraphSchedule {
  entries: AudioGraphScheduleEntry[];
  /**
   * The `AudioContext`-clock timestamp (seconds) corresponding to
   * `startAtMs: 0` — the same zero point every entry's `contextStartTime`
   * is relative to. A caller driving separate video elements in sync with
   * this audio graph (e.g. a video grid) anchors its own start times off
   * this same timestamp.
   */
  videoAnchorTime: number;
}

export interface AudioGraphScheduleEntry {
  takeId: TakeId;
  mediaRef: string;
  /** `AudioContext.currentTime`-relative time (seconds) this Take/Guide should start at. */
  contextStartTime: number;
  volume: number;
  muted: boolean;
}
