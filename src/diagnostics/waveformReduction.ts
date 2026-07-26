/**
 * Downsamples `samples` to `bucketCount` peak (max absolute) values, evenly
 * spanning the buffer. Shared groundwork for the report's per-Track peak
 * array and, later, the on-screen waveform canvas — both are meant to render
 * from the same reduction so audio the onset detector may have mishandled
 * stays visible to a reader who never runs the audio (ADR 0004).
 */
export function downsamplePeaks(samples: Float32Array, bucketCount: number): number[] {
  if (bucketCount <= 0 || samples.length === 0) return [];

  const bucketSize = Math.max(1, Math.ceil(samples.length / bucketCount));
  const peaks: number[] = [];

  for (let start = 0; start < samples.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, samples.length);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    peaks.push(peak);
  }

  return peaks;
}
