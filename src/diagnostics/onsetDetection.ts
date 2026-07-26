export interface OnsetDetectionOptions {
  /** Window used to smooth sample energy before thresholding, in ms. */
  windowMs?: number;
  /** Hop between successive energy windows, in ms — sets the detector's time resolution. */
  hopMs?: number;
  /** Fraction of the buffer's peak envelope an onset must rise above to be reported. */
  riseThreshold?: number;
  /** Fraction of the buffer's peak envelope the envelope must fall back below before a new onset can be reported — the hysteresis that keeps a single decaying transient from re-triggering. */
  fallThreshold?: number;
}

const DEFAULT_WINDOW_MS = 5;
const DEFAULT_HOP_MS = 2;
const DEFAULT_RISE_THRESHOLD = 0.25;
const DEFAULT_FALL_THRESHOLD = 0.12;

/**
 * Energy-threshold onset detection over decoded samples, returning detected
 * onset times in ms from the buffer's own start. Pure: it knows nothing of
 * beats, Takes, or Tracks — only where energy rises out of quiet.
 *
 * Works on a smoothed (windowed RMS) envelope rather than raw sample
 * magnitude, since a beep's zero crossings would otherwise cross a raw
 * threshold many times per cycle and read as a chatter of separate onsets.
 * Hysteresis (a lower fall threshold than the rise threshold) is what lets a
 * single beep's decay register as one onset while still allowing a
 * genuinely separate, closely-following transient — a double-trigger — to
 * register as a second one, which is exactly the distinction the error
 * analysis downstream depends on.
 */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {}
): number[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const hopMs = options.hopMs ?? DEFAULT_HOP_MS;
  const riseThreshold = options.riseThreshold ?? DEFAULT_RISE_THRESHOLD;
  const fallThreshold = options.fallThreshold ?? DEFAULT_FALL_THRESHOLD;

  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const hopSamples = Math.max(1, Math.round((hopMs / 1000) * sampleRate));

  const envelope: number[] = [];
  for (let start = 0; start < samples.length; start += hopSamples) {
    const end = Math.min(start + windowSamples, samples.length);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += samples[i] * samples[i];
    envelope.push(Math.sqrt(sumSquares / (end - start)));
  }

  const peak = envelope.reduce((max, v) => Math.max(max, v), 0);
  if (peak === 0) return [];

  const riseLevel = peak * riseThreshold;
  const fallLevel = peak * fallThreshold;

  const onsetsMs: number[] = [];
  let above = false;
  for (let i = 0; i < envelope.length; i++) {
    const value = envelope[i];
    if (!above && value >= riseLevel) {
      above = true;
      onsetsMs.push(((i * hopSamples) / sampleRate) * 1000);
    } else if (above && value < fallLevel) {
      above = false;
    }
  }
  return onsetsMs;
}
