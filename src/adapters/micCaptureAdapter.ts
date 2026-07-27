import type { CaptureAdapter, CaptureHandle } from "../engine/adapters";

interface ActiveCapture extends CaptureHandle {
  recorder: MediaRecorder;
  chunks: Blob[];
  stopped: Promise<void>;
  resolveStopped: () => void;
}

/**
 * Real, audio-only capture adapter for Mode A's acoustic loopback (ADR 0004):
 * getUserMedia/MediaRecorder over a microphone stream, with no camera and no
 * `waitForFirstFrame` wait. Kept separate from `BrowserCaptureAdapter`, whose
 * `openUnprocessedStream` always asks for video too because a Track is
 * audio+video coupled (`CONTEXT.md`) — Mode A measures a device round trip,
 * not a Track, and has no camera to open.
 */
export class MicCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  private active = new Map<string, ActiveCapture>();
  private armedStream: MediaStream | undefined;

  isArmed(): boolean {
    return this.armedStream !== undefined;
  }

  async arm(): Promise<void> {
    if (this.armedStream) return;
    this.armedStream = await openMicStream();
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
      id: `mic-capture-${this.nextId++}`,
      recorder,
      chunks,
      stopped,
      resolveStopped,
    };
    this.active.set(handle.id, handle);
    recorder.start();
    return { id: handle.id };
  }

  async stopCapture(handle: CaptureHandle): Promise<string> {
    const active = this.active.get(handle.id);
    if (!active) throw new Error(`Unknown capture handle ${handle.id}`);

    active.recorder.stop();
    await active.stopped;
    // Recording stops here; the device stays held open (ADR 0005) — release
    // is `disarm()`'s job, driven by the engine's idle-release timer.
    this.active.delete(handle.id);

    const blob = new Blob(active.chunks, { type: active.recorder.mimeType });
    return URL.createObjectURL(blob);
  }
}

/**
 * Opens the microphone asking for unprocessed audio, falling back to the
 * browser's defaults if the device refuses the constrained request outright.
 *
 * Plain rather than `exact` constraints, so this fallback should be
 * unreachable on a conforming browser — but failing to acquire a device at
 * all is worse than recording it processed.
 */
export async function openMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
  } catch (error) {
    if ((error as Error)?.name !== "OverconstrainedError") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}
