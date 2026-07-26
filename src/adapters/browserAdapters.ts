import type {
  CaptureAdapter,
  CaptureHandle,
  PlaybackAdapter,
  PlaybackHandle,
  PlaybackMixUpdate,
  PlaybackSchedule,
} from "../engine/adapters";
import { computeAudioGraphSchedule } from "../engine/scheduling";
import type { AudioClockSession, AudioProcessingState } from "../diagnostics/types";
import {
  UNPROCESSED_AUDIO_CONSTRAINTS,
  describeAudioProcessing,
  type GrantedAudioSettings,
} from "../diagnostics/audioProcessing";

interface ActiveCapture extends CaptureHandle {
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
 *
 * Arming (`arm`/`disarm`) owns device acquisition and release; `startCapture`/
 * `stopCapture` only start/stop a `MediaRecorder` on the stream already held
 * open by arming (ADR 0005). Device negotiation is not instantaneous and
 * varies by hundreds of milliseconds, so it must not happen inside
 * `startCapture` — that cost would land on the Project timeline's zero point.
 */
export class BrowserCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  private active = new Map<string, ActiveCapture>();
  private latencyByHandleId = new Map<string, number | undefined>();
  private activeCaptureId: string | undefined;
  private audioProcessing: AudioProcessingState | undefined;
  private armedStream: MediaStream | undefined;

  isArmed(): boolean {
    return this.armedStream !== undefined;
  }

  async arm(): Promise<void> {
    if (this.armedStream) return;
    const { stream, constraintsRequested } = await openUnprocessedStream();
    this.audioProcessing = readAudioProcessing(stream, constraintsRequested);
    await waitForFirstFrame(stream);
    this.armedStream = stream;
  }

  async disarm(): Promise<void> {
    if (!this.armedStream) return;
    this.armedStream.getTracks().forEach((track) => track.stop());
    this.armedStream = undefined;
  }

  async startCapture(): Promise<CaptureHandle> {
    if (!this.armedStream) throw new Error("Cannot start capture while unarmed");
    const stream = this.armedStream;
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
    // Recording stops here; the device stays held open (ADR 0005) — release
    // is `disarm()`'s job, driven by the engine's idle-release timer, not
    // this Take's own stop.
    this.active.delete(handle.id);
    if (this.activeCaptureId === handle.id) this.activeCaptureId = undefined;
    this.latencyByHandleId.set(handle.id, estimateMonitorOutputLatencyMs());

    const blob = new Blob(active.chunks, { type: active.recorder.mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * The live `MediaStream` of the in-progress capture, if any — for a
   * real-time self-view preview while recording. Gated on an active
   * `MediaRecorder`, not merely on being armed: the stream is held open
   * across idle time between Takes too (ADR 0005), and a self-view preview
   * before a performer has actually started recording is a separate feature
   * this issue doesn't ask for. UI-only: not part of the `CaptureAdapter`
   * seam, since the engine has no use for a live stream (it only deals in
   * the finished `mediaRef` `stopCapture` returns).
   */
  getActiveStream(): MediaStream | undefined {
    if (!this.activeCaptureId) return undefined;
    return this.armedStream;
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

  /**
   * The processing the most recently opened capture stream actually passed
   * through, read back off the granted track — a Take's provenance, for the
   * diagnostics report (ADR 0004). Undefined until something has been
   * captured. Not part of the CaptureAdapter seam, mirroring
   * getActiveStream(): the engine has no use for it, only the instrument does.
   */
  getAudioProcessing(): AudioProcessingState | undefined {
    return this.audioProcessing;
  }
}

/**
 * Opens a capture stream asking for unprocessed audio, falling back to the
 * browser's defaults if the device refuses the constrained request outright.
 *
 * The constraints are plain rather than `exact`, so this fallback should be
 * unreachable on a conforming browser — but failing to acquire a device at all
 * is a far worse outcome than recording it processed, so a refusal costs a
 * second attempt rather than the Take. Which path ran is returned, so the
 * report can say we never asked rather than that the ask was ignored.
 */
export async function openUnprocessedStream(): Promise<{
  stream: MediaStream;
  constraintsRequested: boolean;
}> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...UNPROCESSED_AUDIO_CONSTRAINTS },
      video: true,
    });
    return { stream, constraintsRequested: true };
  } catch (error) {
    // A permission denial must still reject: only an unsatisfiable constraint
    // is worth retrying, and retrying a refusal would just prompt twice.
    if ((error as Error)?.name !== "OverconstrainedError") throw error;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    return { stream, constraintsRequested: false };
  }
}

/**
 * Reads what the granted audio track says it is actually doing. Nothing is
 * assumed from what was asked for: constraint support varies by platform and
 * browser build, and `getSettings` is what the device answered.
 */
export function readAudioProcessing(
  stream: MediaStream,
  constraintsRequested: boolean
): AudioProcessingState {
  const track = stream.getAudioTracks()[0];
  const settings: GrantedAudioSettings | null = track?.getSettings
    ? (track.getSettings() as GrantedAudioSettings)
    : null;
  return describeAudioProcessing(settings, { constraintsRequested });
}

/**
 * Resolves once `stream` is actually delivering a decoded video frame, not
 * merely once `getUserMedia` has resolved a stream object — a camera can
 * still be ramping exposure/gain at that point, and a `MediaRecorder`
 * started too early can produce media whose opening is missing or dark
 * (ADR 0005). Resolves immediately for an audio-only stream, since there is
 * no video frame to wait for and Web Audio exposes no equivalent readiness
 * signal for the input side. Not the common path today: `openUnprocessedStream`
 * always requests audio+video together, since a Track is audio+video coupled
 * (`CONTEXT.md`) — an audio-only Track remains a future variant, not
 * supported yet — so this branch is a defensive fallback rather than a gap
 * this issue leaves open for the devices it actually acquires.
 */
function waitForFirstFrame(stream: MediaStream): Promise<void> {
  if (stream.getVideoTracks().length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    const cleanup = () => {
      video.srcObject = null;
    };
    const ready = () => {
      cleanup();
      resolve();
    };

    const requestVideoFrameCallback = (
      video as Partial<{ requestVideoFrameCallback: (callback: () => void) => number }>
    ).requestVideoFrameCallback;
    if (requestVideoFrameCallback) {
      requestVideoFrameCallback.call(video, ready);
    } else {
      video.onloadeddata = ready;
    }
    void video.play().catch(() => {
      // A play() rejection here (e.g. autoplay policy) still leaves frames
      // decoding once the stream is attached in most browsers; onloadeddata
      // /requestVideoFrameCallback above is the actual readiness signal.
    });
  });
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
  private audioClockSession: AudioClockSession | undefined;

  /**
   * The single AudioContext shared across every play() call for this
   * adapter's lifetime. Public because the Count-in click source schedules
   * against it too: the Count-in's last beat and the Guide that follows it
   * at t=0 must be timed on one clock, not two.
   */
  getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.audioClockSession = {
        sessionId: `audio-clock-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        createdAtEpochMs: Date.now(),
      };
    }
    return this.audioContext;
  }

  /**
   * Identifies the clock `getAudioContext().currentTime` reads from, for
   * diagnostics reports whose timestamps count from its creation. Undefined
   * until something has actually needed the context — note that the first
   * caller may be the diagnostics event sink rather than playback, which is
   * why the session is minted here and not in play().
   *
   * Not part of the PlaybackAdapter seam, mirroring getSyncedStartDelayMs().
   */
  getAudioClockSession(): AudioClockSession | undefined {
    return this.audioClockSession;
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
