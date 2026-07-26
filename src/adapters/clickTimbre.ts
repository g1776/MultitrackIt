/**
 * How a click track sounds. Shared by the Count-in click source and the
 * generated metronome Guide: they are heard in the same session, seconds
 * apart, so a downbeat must sound like a downbeat in both — a divergence
 * here would be audible as two different metronomes.
 */
export const CLICK_DURATION_S = 0.03;

/** Frequency (Hz) of a click, higher on the accented first beat of a bar. */
export function clickFrequencyHz(accent: boolean): number {
  return accent ? 1500 : 1000;
}

/** Peak amplitude of a click, louder on the accented first beat of a bar. */
export function clickPeakAmplitude(accent: boolean): number {
  return accent ? 0.9 : 0.6;
}
