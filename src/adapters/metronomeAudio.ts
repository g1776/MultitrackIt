import { computeMetronomeClicks, type MetronomeParams } from "../engine/metronome";
import { CLICK_DURATION_S, clickFrequencyHz, clickPeakAmplitude } from "./clickTimbre";
import { encodeWav } from "./wav";

const SAMPLE_RATE = 44100;

/**
 * Renders a metronome click at `atMs` into `channel`: a short sine burst
 * with a linear decay envelope, pitched/louder on accented (downbeat)
 * clicks so the performer can hear bar boundaries.
 */
function renderClick(channel: Float32Array, atMs: number, accent: boolean): void {
  const startSample = Math.round((atMs / 1000) * SAMPLE_RATE);
  const durationSamples = Math.round(CLICK_DURATION_S * SAMPLE_RATE);
  const frequency = clickFrequencyHz(accent);
  const peakAmplitude = clickPeakAmplitude(accent);

  for (let i = 0; i < durationSamples; i++) {
    const sampleIndex = startSample + i;
    if (sampleIndex >= channel.length) break;
    const t = i / SAMPLE_RATE;
    const envelope = 1 - i / durationSamples;
    channel[sampleIndex] += Math.sin(2 * Math.PI * frequency * t) * envelope * peakAmplitude;
  }
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
