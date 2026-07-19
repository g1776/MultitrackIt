import type {
  CaptureAdapter,
  CaptureHandle,
  PlaybackAdapter,
  PlaybackHandle,
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

    const blob = new Blob(active.chunks, { type: active.recorder.mimeType });
    return URL.createObjectURL(blob);
  }
}

interface ActivePlayback extends PlaybackHandle {
  elements: HTMLVideoElement[];
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
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const entry of schedule.entries) {
      const video = document.createElement("video");
      video.src = entry.mediaRef;
      video.volume = entry.muted ? 0 : entry.volume;
      elements.push(video);

      const delay = Math.max(0, entry.startAtMs);
      timers.push(
        setTimeout(() => {
          // Guard against a timer outliving a stop() call for this handle.
          if (this.active.has(id)) void video.play();
        }, delay)
      );
    }

    const handle: ActivePlayback = { id, elements, timers };
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
}
