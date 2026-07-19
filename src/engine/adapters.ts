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
}

export interface PlaybackHandle {
  id: string;
}
