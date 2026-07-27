import type {
  CaptureAdapter,
  CaptureHandle,
  CountInAdapter,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackMixUpdate,
  PlaybackSchedule,
} from "./adapters";
import type { MetronomeClick, MetronomeParams } from "./metronome";
import type { MetronomeAudioSource } from "./RecordingEngine";

/**
 * In-memory capture adapter for tests: no real AV I/O. Models arming as its
 * own held-open state (ADR 0005), separate from a Take's start/stop, so
 * engine tests can assert acquisition happens once per session rather than
 * once per Take.
 */
export class FakeCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  private armedState = false;
  public startedHandles: CaptureHandle[] = [];
  public stoppedMediaRefs: string[] = [];
  /** Set to control what `getLatencyMs` reports for the next `stopCapture`. */
  public reportedLatencyMs: number | undefined = undefined;
  /** Number of times `arm()` actually acquired — excludes no-op calls while already armed. */
  public armCount = 0;
  /** Number of times `disarm()` actually released — excludes no-op calls while already unarmed. */
  public disarmCount = 0;
  /** Set to make the next `arm()` attempt reject, simulating permission denial or an absent device. */
  public armError: Error | undefined = undefined;
  /** Simulated delay (ms) before `arm()` resolves, for tests observing the arming wait. */
  public armDelayMs = 0;

  isArmed(): boolean {
    return this.armedState;
  }

  async arm(): Promise<void> {
    if (this.armedState) return;
    if (this.armDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.armDelayMs));
    }
    if (this.armError) throw this.armError;
    this.armCount += 1;
    this.armedState = true;
  }

  async disarm(): Promise<void> {
    if (!this.armedState) return;
    this.disarmCount += 1;
    this.armedState = false;
  }

  async startCapture(): Promise<CaptureHandle> {
    if (!this.armedState) throw new Error("Cannot start capture while unarmed");
    const handle = { id: `capture-${this.nextId++}` };
    this.startedHandles.push(handle);
    return handle;
  }

  async stopCapture(handle: CaptureHandle): Promise<string> {
    const mediaRef = `media-${handle.id}`;
    this.stoppedMediaRefs.push(mediaRef);
    return mediaRef;
  }

  getLatencyMs(): number | undefined {
    return this.reportedLatencyMs;
  }
}

/** In-memory Count-in click source for tests: records the clicks it was asked to sound. */
export class FakeCountInAdapter implements CountInAdapter {
  public playedCountIns: MetronomeClick[][] = [];
  public cancelCount = 0;

  async playCountIn(clicks: MetronomeClick[]): Promise<void> {
    this.playedCountIns.push(clicks);
  }

  cancel(): void {
    this.cancelCount += 1;
  }
}

/** In-memory playback adapter for tests: records what it was asked to play. */
export class FakePlaybackAdapter implements PlaybackAdapter {
  private nextId = 1;
  public playedSchedules: PlaybackSchedule[] = [];
  public stoppedHandles: PlaybackHandle[] = [];
  public mixUpdates: { handle: PlaybackHandle; updates: PlaybackMixUpdate[] }[] = [];

  async play(schedule: PlaybackSchedule): Promise<PlaybackHandle> {
    this.playedSchedules.push(schedule);
    return { id: `playback-${this.nextId++}` };
  }

  async stop(handle: PlaybackHandle): Promise<void> {
    this.stoppedHandles.push(handle);
  }

  updateMix(handle: PlaybackHandle, updates: PlaybackMixUpdate[]): void {
    this.mixUpdates.push({ handle, updates });
  }
}

/**
 * In-memory Metronome audio source for tests: no real WAV synthesis, just a
 * mediaRef that encodes the params it was called with, so a test can assert
 * a particular tempo/duration produced it without decoding audio.
 */
export const fakeMetronomeAudio: MetronomeAudioSource = (params: MetronomeParams) =>
  `metronome-${params.bpm}-${params.beatsPerBar}-${params.durationMs}`;
