import type { CountInAdapter } from "../engine/adapters";
import type { MetronomeClick } from "../engine/metronome";
import { CLICK_DURATION_S, clickFrequencyHz, clickPeakAmplitude } from "./clickTimbre";


/**
 * Real Count-in click source: synthesises each beat as a short decaying sine
 * burst scheduled on the `AudioContext` clock, downbeats higher and louder so
 * bar boundaries are audible.
 *
 * Takes the same `AudioContext` the playback adapter schedules its graph
 * against (hence the provider function rather than its own context), so the
 * beat the performer counts to and the Guide that follows it at t=0 are
 * timed against one clock rather than two that can disagree.
 */
export class BrowserCountInAdapter implements CountInAdapter {
  private scheduled: OscillatorNode[] = [];

  constructor(private readonly getAudioContext: () => AudioContext) {}

  async playCountIn(clicks: MetronomeClick[], startDelayMs = 0): Promise<void> {
    const audioContext = this.getAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();

    // One reference instant for the whole Count-in, read once: every beat is
    // scheduled off it, so beat spacing can't inherit the jitter of reading
    // the clock per beat. `startDelayMs` shifts that instant forward to the
    // same moment the Monitor Mix/Guide already started against (see
    // `PlaybackAdapter.getScheduledStartDelayMs`), rather than this always
    // being "right now" regardless of when the caller actually invoked it.
    const startTime = audioContext.currentTime + startDelayMs / 1000;
    this.scheduled = clicks.map((click) => {
      const at = startTime + click.atMs / 1000;
      const oscillator = audioContext.createOscillator();
      oscillator.frequency.value = clickFrequencyHz(click.accent);

      const gain = audioContext.createGain();
      const peak = clickPeakAmplitude(click.accent);
      gain.gain.setValueAtTime(peak, at);
      gain.gain.linearRampToValueAtTime(0, at + CLICK_DURATION_S);
      gain.connect(audioContext.destination);

      oscillator.connect(gain);
      oscillator.start(at);
      oscillator.stop(at + CLICK_DURATION_S);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      return oscillator;
    });
  }

  cancel(): void {
    for (const oscillator of this.scheduled) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped (or never started): nothing left to silence.
      }
    }
    this.scheduled = [];
  }
}
