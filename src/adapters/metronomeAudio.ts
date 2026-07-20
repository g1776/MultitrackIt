import { computeMetronomeClicks, type MetronomeParams } from "../engine/metronome";

const SAMPLE_RATE = 44100;
const CLICK_DURATION_S = 0.03;

/**
 * Renders a metronome click at `atMs` into `channel`: a short sine burst
 * with a linear decay envelope, pitched/louder on accented (downbeat)
 * clicks so the performer can hear bar boundaries.
 */
function renderClick(channel: Float32Array, atMs: number, accent: boolean): void {
  const startSample = Math.round((atMs / 1000) * SAMPLE_RATE);
  const durationSamples = Math.round(CLICK_DURATION_S * SAMPLE_RATE);
  const frequency = accent ? 1500 : 1000;
  const peakAmplitude = accent ? 0.9 : 0.6;

  for (let i = 0; i < durationSamples; i++) {
    const sampleIndex = startSample + i;
    if (sampleIndex >= channel.length) break;
    const t = i / SAMPLE_RATE;
    const envelope = 1 - i / durationSamples;
    channel[sampleIndex] += Math.sin(2 * Math.PI * frequency * t) * envelope * peakAmplitude;
  }
}

/** Encodes a mono Float32 PCM buffer as a 16-bit WAV Blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, text: string) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Generates a metronome click-track guide as a playable media URL, per the
 * given bpm/time-signature/duration. This is the browser-specific synthesis
 * step (Web Audio-free, pure sample synthesis + WAV encoding so it works
 * without an AudioContext); the engine only ever sees the resulting
 * mediaRef via `importGuide`.
 */
export function generateMetronomeGuideAudio(params: MetronomeParams): string {
  const clicks = computeMetronomeClicks(params);
  const totalSamples = Math.ceil((params.durationMs / 1000) * SAMPLE_RATE);
  const channel = new Float32Array(totalSamples);

  for (const click of clicks) {
    renderClick(channel, click.atMs, click.accent);
  }

  const blob = encodeWav(channel, SAMPLE_RATE);
  return URL.createObjectURL(blob);
}
