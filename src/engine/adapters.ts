import type { MetronomeClick } from "./metronome";
import type { TakeId } from "./types";

/**
 * Seam between the recording engine and real OS-level AV I/O. The engine
 * depends only on these interfaces, never on Electron/browser AV APIs
 * directly, so it can be exercised in tests with fakes.
 */
export interface CaptureAdapter {
  /** Begin capturing audio+video. Returns a handle used to stop it. */
  startCapture(): Promise<CaptureHandle>;
  /** Stop capturing and persist the result, returning an opaque media ref. */
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
   */
  playCountIn(clicks: MetronomeClick[]): Promise<void>;
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
