import type { AudioProcessingControl, AudioProcessingName, AudioProcessingState } from "./types";

/**
 * What capture asks the browser for: every voice-call processor off.
 *
 * A bare `audio: true` accepts the browser's defaults, which enable all three.
 * They are tuned for a call, not for music. Echo cancellation is the worst of
 * them here: this app plays a Monitor Mix during every recording pass by
 * design, so AEC would spend each Take subtracting the Guide and the existing
 * Tracks from the performer's own signal. Automatic gain control rides the
 * input level across a Take (and on a USB microphone can move the device's own
 * gain), and noise suppression removes sustains, decay and reverb tails —
 * exactly what a musician wants kept.
 *
 * These are stated as plain (non-`exact`) constraints deliberately: a device
 * that can't honour them should still open, and the fact that it didn't is
 * read back afterwards rather than turned into a failure to acquire.
 */
export const UNPROCESSED_AUDIO_CONSTRAINTS: Record<AudioProcessingName, false> = {
  echoCancellation: false,
  autoGainControl: false,
  noiseSuppression: false,
};

const PROCESSING_NAMES = Object.keys(UNPROCESSED_AUDIO_CONSTRAINTS) as AudioProcessingName[];

/**
 * What a granted audio track reports about itself — the subset of
 * `MediaTrackSettings` this cares about. Each field is optional because a
 * browser reports only the settings it actually models.
 */
export type GrantedAudioSettings = Partial<Record<AudioProcessingName, boolean>>;

/**
 * Reconciles what capture asked for against what the granted track says it
 * actually did, into the statement a report makes about a pass's provenance
 * (ADR 0004).
 *
 * Constraint support varies by platform and browser build, so nothing here is
 * inferred from the request: a control the device never reported is `null`,
 * not "as requested". A report that cannot say whether AGC was active must say
 * that, rather than let a later reader assume a clean capture.
 *
 * @param settings the granted track's settings, or null when there was no
 *   audio track to read (nothing was learned about the pass).
 * @param options.constraintsRequested false when capture had to fall back to
 *   the browser's defaults because the constrained request was refused.
 */
export function describeAudioProcessing(
  settings: GrantedAudioSettings | null,
  options: { constraintsRequested?: boolean } = {}
): AudioProcessingState {
  const constraintsRequested = options.constraintsRequested ?? true;

  const controls = {} as Record<AudioProcessingName, AudioProcessingControl>;
  for (const name of PROCESSING_NAMES) {
    const actualEnabled = settings?.[name] ?? null;
    const requestedEnabled = constraintsRequested ? UNPROCESSED_AUDIO_CONSTRAINTS[name] : null;
    controls[name] = {
      requestedEnabled,
      actualEnabled,
      honoured:
        requestedEnabled === null || actualEnabled === null
          ? null
          : actualEnabled === requestedEnabled,
    };
  }

  const stillActive = PROCESSING_NAMES.filter((name) => controls[name].actualEnabled === true);
  const unreported = PROCESSING_NAMES.filter((name) => controls[name].actualEnabled === null);

  // "processed" outranks "unknown": one processor known to be on is a fact
  // about the recording, whatever else went unreported.
  const summary = stillActive.length > 0 ? "processed" : unreported.length > 0 ? "unknown" : "unprocessed";

  return { constraintsRequested, controls, stillActive, unreported, summary };
}
