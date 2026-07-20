import type {
  CaptureAdapter,
  CaptureHandle,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackMixUpdate,
  PlaybackSchedule,
} from "../engine/adapters";

interface ActiveCapture extends CaptureHandle {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  stopped: Promise<void>;
  resolveStopped: () => void;
}

/**
 * Real capture adapter backed by the browser AV stack available in
 * Electron's renderer process (getUserMedia + MediaRecorder). This is the
 * Electron/OS-backed implementation of the CaptureAdapter seam; the engine
 * never touches these APIs directly.
 */
export class BrowserCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  private active = new Map<string, ActiveCapture>();
  private latencyByHandleId = new Map<string, number | undefined>();
  private activeCaptureId: string | undefined;

  async startCapture(): Promise<CaptureHandle> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    let resolveStopped!: () => void;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    recorder.onstop = () => resolveStopped();

    const handle: ActiveCapture = {
      id: `capture-${this.nextId++}`,
      stream,
      recorder,
      chunks,
      stopped,
      resolveStopped,
    };
    this.active.set(handle.id, handle);
    this.activeCaptureId = handle.id;
    recorder.start();
    return { id: handle.id };
  }

  async stopCapture(handle: CaptureHandle): Promise<string> {
    const active = this.active.get(handle.id);
    if (!active) throw new Error(`Unknown capture handle ${handle.id}`);

    active.recorder.stop();
    await active.stopped;
    active.stream.getTracks().forEach((track) => track.stop());
    this.active.delete(handle.id);
    if (this.activeCaptureId === handle.id) this.activeCaptureId = undefined;
    this.latencyByHandleId.set(handle.id, estimateMonitorOutputLatencyMs());

    const blob = new Blob(active.chunks, { type: active.recorder.mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * The live `MediaStream` of the in-progress capture, if any — for a
   * real-time self-view preview while recording. UI-only: not part of the
   * `CaptureAdapter` seam, since the engine has no use for a live stream
   * (it only deals in the finished `mediaRef` `stopCapture` returns).
   */
  getActiveStream(): MediaStream | undefined {
    if (!this.activeCaptureId) return undefined;
    return this.active.get(this.activeCaptureId)?.stream;
  }

  /**
   * Returns the latency estimated for the capture most recently stopped.
   * Best-effort estimate of Monitor Mix *output* latency only, via
   * `AudioContext` — the Web Audio API exposes no input-side latency, so
   * this doesn't capture mic/input delay. A calibration-tone adapter (per
   * the originating spec) would give a fuller round-trip figure.
   */
  getLatencyMs(): number | undefined {
    const lastHandleId = `capture-${this.nextId - 1}`;
    return this.latencyByHandleId.get(lastHandleId);
  }
}

function estimateMonitorOutputLatencyMs(): number | undefined {
  if (typeof AudioContext === "undefined") return undefined;

  const audioContext = new AudioContext();
  const outputLatencySec = audioContext.outputLatency || audioContext.baseLatency || 0;
  void audioContext.close();

  return outputLatencySec > 0 ? outputLatencySec * 1000 : undefined;
}

interface ActivePlayback extends PlaybackHandle {
  elements: HTMLVideoElement[];
  elementsByTakeId: Map<string, HTMLVideoElement>;
  timers: ReturnType<typeof setTimeout>[];
}

/**
 * Real playback adapter: renders each scheduled Take in an offscreen
 * <video> element (giving audio+video together) and starts it at its
 * computed offset within the schedule.
 */
export class BrowserPlaybackAdapter implements PlaybackAdapter {
  private nextId = 1;
  private active = new Map<string, ActivePlayback>();

  async play(schedule: PlaybackSchedule): Promise<PlaybackHandle> {
    const id = `playback-${this.nextId++}`;
    const elements: HTMLVideoElement[] = [];
    const elementsByTakeId = new Map<string, HTMLVideoElement>();
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const entry of schedule.entries) {
      const video = document.createElement("video");
      video.src = entry.mediaRef;
      video.volume = entry.muted ? 0 : entry.volume;
      elements.push(video);
      elementsByTakeId.set(entry.takeId, video);

      const delay = Math.max(0, entry.startAtMs);
      timers.push(
        setTimeout(() => {
          // Guard against a timer outliving a stop() call for this handle.
          if (this.active.has(id)) void video.play();
        }, delay)
      );
    }

    const handle: ActivePlayback = { id, elements, elementsByTakeId, timers };
    this.active.set(handle.id, handle);
    return { id: handle.id };
  }

  async stop(handle: PlaybackHandle): Promise<void> {
    const active = this.active.get(handle.id);
    if (!active) return;
    active.timers.forEach(clearTimeout);
    active.elements.forEach((el) => {
      el.pause();
      el.removeAttribute("src");
      el.load();
    });
    this.active.delete(handle.id);
  }

  updateMix(handle: PlaybackHandle, updates: PlaybackMixUpdate[]): void {
    const active = this.active.get(handle.id);
    if (!active) return;
    for (const update of updates) {
      const el = active.elementsByTakeId.get(update.takeId);
      if (el) el.volume = update.muted ? 0 : update.volume;
    }
  }
}
