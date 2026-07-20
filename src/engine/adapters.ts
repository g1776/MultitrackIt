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
