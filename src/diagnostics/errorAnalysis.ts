/** One expected beat, matched against a detected onset or not. */
export interface BeatMatch {
  beatIndex: number;
  expectedMs: number;
  /** `detected - expected`, signed. Null when no onset matched this beat within tolerance. */
  errorMs: number | null;
}

export interface ErrorAnalysisResult {
  /** One entry per expected beat, in order. */
  perBeat: BeatMatch[];
  /** Detected onsets that matched no expected beat — a double-trigger or spurious noise, not a shifted error. */
  spuriousOnsetsMs: number[];
}

export interface AnalyseErrorsOptions {
  /**
   * Max ms an onset may be from an expected beat and still count as that
   * beat's detection. Defaults to half the beat interval, which is the
   * widest tolerance that still can't confuse a beat with its neighbour.
   */
  matchToleranceMs?: number;
}

function defaultTolerance(expectedBeatTimesMs: number[]): number {
  if (expectedBeatTimesMs.length < 2) return Infinity;
  const interval = expectedBeatTimesMs[1] - expectedBeatTimesMs[0];
  return interval / 2;
}

/**
 * Pairs detected onsets with expected beat times, producing one signed error
 * per beat rather than one per Track (ADR 0004) — what distinguishes a
 * constant offset (all errors equal) from drift (errors ramp) from jitter
 * (errors scatter). Pure: given the two time arrays, everything else is
 * arithmetic.
 *
 * Each expected beat claims its *nearest* unclaimed onset within tolerance,
 * in beat order. A beat with no onset within tolerance is reported missing
 * (`errorMs: null`) rather than silently skipped or matched to some other
 * beat's onset. An onset no beat claims — a double-trigger, or spurious
 * noise — is reported separately rather than folded into a shifted error.
 */
export function analyseErrors(
  expectedBeatTimesMs: number[],
  detectedOnsetsMs: number[],
  options: AnalyseErrorsOptions = {}
): ErrorAnalysisResult {
  const tolerance = options.matchToleranceMs ?? defaultTolerance(expectedBeatTimesMs);

  const candidates = detectedOnsetsMs.map((atMs) => ({ atMs, claimed: false }));

  const perBeat: BeatMatch[] = expectedBeatTimesMs.map((expectedMs, beatIndex) => {
    let best: (typeof candidates)[number] | null = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate.claimed) continue;
      const distance = Math.abs(candidate.atMs - expectedMs);
      if (distance <= tolerance && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (!best) return { beatIndex, expectedMs, errorMs: null };
    best.claimed = true;
    return { beatIndex, expectedMs, errorMs: best.atMs - expectedMs };
  });

  const spuriousOnsetsMs = candidates.filter((c) => !c.claimed).map((c) => c.atMs);

  return { perBeat, spuriousOnsetsMs };
}
