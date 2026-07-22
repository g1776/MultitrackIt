import type {
  CaptureAdapter,
  CaptureHandle,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackMixUpdate,
  PlaybackSchedule,
} from "../engine/adapters";
import { computeAudioGraphSchedule } from "../engine/scheduling";

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
  gainsByTakeId: Map<string, GainNode>;
  sources: MediaElementAudioSourceNode[];
  timers: ReturnType<typeof setTimeout>[];
  /** The AudioContext-clock timestamp corresponding to this schedule's startAtMs: 0. */
  videoAnchorTime: number;
}

/**
 * Real playback adapter: routes every scheduled Take's/Guide's audio
 * through one shared AudioContext graph (a GainNode per entry, fed by a
 * MediaElementAudioSourceNode pulled from that entry's own offscreen
 * <video> element) rather than relying on each element's independent
 * timer and volume, so Takes/Guide stay sample-accurately scheduled
 * against one clock instead of drifting apart during a session (ADR 0002).
 * The <video> elements remain the actual audio+video source — only the
 * volume/mute path and start-time scheduling are graph-driven.
 */
export class BrowserPlaybackAdapter implements PlaybackAdapter {
  private nextId = 1;
  private active = new Map<string, ActivePlayback>();
  private audioContext: AudioContext | undefined;

  /** The single AudioContext shared across every play() call for this adapter's lifetime. */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) this.audioContext = new AudioContext();
    return this.audioContext;
  }

  async play(schedule: PlaybackSchedule): Promise<PlaybackHandle> {
    const id = `playback-${this.nextId++}`;
    const audioContext = this.getAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();

    // No artificial lead added here: playback (unlike recording, which has
    // its own visible Count-in) must stay as immediate as before — any
    // buffering happens silently against this same reference instant
    // rather than delaying it.
    const referenceTime = audioContext.currentTime;
    const graphSchedule = computeAudioGraphSchedule(schedule, referenceTime);

    const elements: HTMLVideoElement[] = [];
    const gainsByTakeId = new Map<string, GainNode>();
    const sources: MediaElementAudioSourceNode[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const entry of graphSchedule.entries) {
      const video = document.createElement("video");
      video.src = entry.mediaRef;
      elements.push(video);

      const gain = audioContext.createGain();
      gain.gain.value = entry.muted ? 0 : entry.volume;
      gain.connect(audioContext.destination);
      gainsByTakeId.set(entry.takeId, gain);

      const source = audioContext.createMediaElementSource(video);
      source.connect(gain);
      sources.push(source);

      const delayMs = Math.max(0, (entry.contextStartTime - audioContext.currentTime) * 1000);
      timers.push(
        setTimeout(() => {
          // Guard against a timer outliving a stop() call for this handle.
          if (this.active.has(id)) void video.play();
        }, delayMs)
      );
    }

    const handle: ActivePlayback = {
      id,
      elements,
      gainsByTakeId,
      sources,
      timers,
      videoAnchorTime: graphSchedule.videoAnchorTime,
    };
    this.active.set(handle.id, handle);
    return { id: handle.id };
  }

  async stop(handle: PlaybackHandle): Promise<void> {
    const active = this.active.get(handle.id);
    if (!active) return;
    active.timers.forEach(clearTimeout);
    active.sources.forEach((source) => source.disconnect());
    active.gainsByTakeId.forEach((gain) => gain.disconnect());
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
      const gain = active.gainsByTakeId.get(update.takeId);
      if (gain) gain.gain.value = update.muted ? 0 : update.volume;
    }
  }

  /**
   * Milliseconds from now a cell starting at `startAtMs` (same
   * offset-normalized units as a `PlaybackSchedule` entry) should start, to
   * stay in sync with this handle's audio graph — for a caller that
   * renders its own separate <video> elements (e.g. the video grid). Undoes
   * the arithmetic here rather than in the caller, so the AudioContext
   * clock read/scheduling math stays with the adapter that owns the clock.
   * Not part of the PlaybackAdapter seam — UI-only, mirroring
   * getActiveStream() on BrowserCaptureAdapter. Returns undefined if
   * `handle` isn't (or is no longer) active.
   */
  getSyncedStartDelayMs(handle: PlaybackHandle, startAtMs: number): number | undefined {
    const active = this.active.get(handle.id);
    if (!active || !this.audioContext) return undefined;
    const startTime = active.videoAnchorTime + startAtMs / 1000;
    return Math.max(0, (startTime - this.audioContext.currentTime) * 1000);
  }
}
