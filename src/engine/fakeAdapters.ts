import type {
  CaptureAdapter,
  CaptureHandle,
  CountInAdapter,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackMixUpdate,
  PlaybackSchedule,
} from "./adapters";
import type { MetronomeClick } from "./metronome";

/** In-memory capture adapter for tests: no real AV I/O. */
export class FakeCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  public startedHandles: CaptureHandle[] = [];
  public stoppedMediaRefs: string[] = [];
  /** Set to control what `getLatencyMs` reports for the next `stopCapture`. */
  public reportedLatencyMs: number | undefined = undefined;

  async startCapture(): Promise<CaptureHandle> {
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
