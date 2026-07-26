import type { CaptureAdapter, CaptureHandle } from "../engine/adapters";
import {
  pitchHzForIndex,
  renderSyntheticTake,
  SYNTHETIC_SAMPLE_RATE,
  type SyntheticSignalParams,
} from "../diagnostics/syntheticSignal";
import { encodeWav } from "./wav";

export interface SyntheticCaptureAdapterOptions extends SyntheticSignalParams {
  /**
   * Simulated device-acquisition delay (ms) for `arm()`. Defaults to 0.
   * Real acquisition varies by hundreds of milliseconds (ADR 0005); this lets
   * a synthetic run still exercise arming taking measurable, variable time —
   * ahead of the fixed lead-in, same as the real adapter — without assuming
   * acquisition away, which would report green over a defect in this seam.
   */
  armDelayMs?: number;
  /**
   * Simulated round-trip capture latency (ms). Defaults to 0. Shifts every
   * fabricated onset later by this amount, and is reported back through
   * `getLatencyMs()` — the same method a real capture estimate would use —
   * so injecting a known value both proves the analysis can report a known
   * non-zero error and exercises the engine's Offset-correction path end to
   * end (ADR 0004).
   */
  simulatedLatencyMs?: number;
}

/**
 * Fabricates the media a flawless performer would have produced: one beep
 * per beat at the beat grid's times, at a per-Track distinct pitch, with no
 * microphone or camera involved. Implements the existing `CaptureAdapter`
 * seam unchanged, so the engine cannot tell a synthetic Take from a real one
 * (ADR 0004) — a synthetic Take is an ordinary Take, enforced by construction
 * rather than by discipline.
 *
 * Participates in the arm/record/release lifecycle ADR 0005 introduced
 * (rather than resolving `arm()` instantly) so a synthetic run still
 * exercises — and can regression-test — arming happening ahead of the
 * lead-in instead of assuming the layer that caused ADR 0005 away.
 */
export class SyntheticCaptureAdapter implements CaptureAdapter {
  private nextId = 1;
  private takeIndex = 0;
  private armedState = false;
  private readonly signal: SyntheticSignalParams;
  private readonly armDelayMs: number;
  private readonly simulatedLatencyMs: number;

  constructor(options: SyntheticCaptureAdapterOptions) {
    const { armDelayMs, simulatedLatencyMs, ...signal } = options;
    this.signal = signal;
    this.armDelayMs = armDelayMs ?? 0;
    this.simulatedLatencyMs = simulatedLatencyMs ?? 0;
  }

  isArmed(): boolean {
    return this.armedState;
  }

  async arm(): Promise<void> {
    if (this.armedState) return;
    if (this.armDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.armDelayMs));
    }
    this.armedState = true;
  }

  async disarm(): Promise<void> {
    this.armedState = false;
  }

  async startCapture(): Promise<CaptureHandle> {
    if (!this.armedState) throw new Error("Cannot start capture while unarmed");
    return { id: `synthetic-capture-${this.nextId++}` };
  }

  /**
   * Fabricates the finished Take: one beep per beat, at the next distinct
   * pitch in sequence. Pitch is assigned by capture order rather than passed
   * in, because `CaptureAdapter` carries no notion of which Track is being
   * recorded (by design — widening it would be a change to the seam the
   * engine depends on) and this scenario records exactly one Take per Track
   * in order, so capture order and Track order coincide.
   */
  async stopCapture(_handle: CaptureHandle): Promise<string> {
    const pitchHz = pitchHzForIndex(this.takeIndex);
    this.takeIndex += 1;

    const samples = renderSyntheticTake(this.signal, pitchHz, this.simulatedLatencyMs);
    const blob = encodeWav(samples, SYNTHETIC_SAMPLE_RATE);
    return URL.createObjectURL(blob);
  }

  /**
   * Reports the configured `simulatedLatencyMs` — 0 by default — through the
   * same method a real latency estimate would use, so injecting a known
   * value exercises the engine's Offset-correction path end to end (ADR
   * 0004), not just the analysis that reads the raw captured signal.
   */
  getLatencyMs(): number | undefined {
    return this.simulatedLatencyMs;
  }
}
