import { describe, it, expect, vi } from "vitest";
import {
  FakeCaptureAdapter,
  FakeCountInAdapter,
  FakePlaybackAdapter,
  fakeMetronomeAudio,
} from "../engine/fakeAdapters";
import { FakeDiagnosticsStorageAdapter } from "./fakeDiagnosticsStorageAdapter";
import { computeMetronomeClicks } from "../engine/metronome";
import { renderBeepsAtTimes, SYNTHETIC_SAMPLE_RATE } from "./syntheticSignal";
import {
  CalibrationFailedError,
  DEFAULT_FULL_SUITE_PARAMS,
  runFullDiagnosticsSuite,
  type RunFullDiagnosticsSuiteOptions,
} from "./fullSuite";

/** Skips every real lead-in/performance wait so tests run instantly. */
const FAST: Partial<RunFullDiagnosticsSuiteOptions> = {
  countInBars: 0,
  countInPaddingMs: 0,
  idleReleaseMs: 0,
  sleep: async () => {},
};

/**
 * A decode stub whose first call (the calibration pass's lone Track) returns
 * real, onset-detectable audio at the calibration scenario's own expected
 * beat grid shifted by `injectedLatencyMs` — so `checkCalibration` sees a
 * genuine measured value rather than "no beats detected". Every later call
 * (Mode B's Tracks, Mode A's capture) returns silence: those phases' own
 * numeric analysis isn't under test here, only that they ran.
 */
function decodeWithCalibrationSignal(injectedLatencyMs: number, params = DEFAULT_FULL_SUITE_PARAMS) {
  const beatIntervalMs = 60000 / params.tempoBpm;
  const durationMs = params.beatCount * beatIntervalMs;
  const expectedBeatTimesMs = computeMetronomeClicks({
    bpm: params.tempoBpm,
    beatsPerBar: params.beatsPerBar,
    durationMs,
  })
    .slice(0, params.beatCount)
    .map((click) => click.atMs);

  let callCount = 0;
  return vi.fn(async () => {
    callCount += 1;
    if (callCount === 1) {
      const atMsList = expectedBeatTimesMs.map((t) => t + injectedLatencyMs);
      return {
        samples: renderBeepsAtTimes(atMsList, 440, durationMs),
        sampleRate: SYNTHETIC_SAMPLE_RATE,
      };
    }
    return { samples: new Float32Array(100), sampleRate: SYNTHETIC_SAMPLE_RATE };
  });
}

function options(overrides: Partial<RunFullDiagnosticsSuiteOptions> = {}): RunFullDiagnosticsSuiteOptions {
  return {
    capture: new FakeCaptureAdapter(),
    playback: new FakePlaybackAdapter(),
    countIn: new FakeCountInAdapter(),
    metronomeAudio: fakeMetronomeAudio,
    audioContext: { sampleRate: SYNTHETIC_SAMPLE_RATE } as AudioContext,
    storage: new FakeDiagnosticsStorageAdapter(),
    now: () => "2026-07-26T12:00:00.000Z",
    decode: decodeWithCalibrationSignal(80),
    ...FAST,
    ...overrides,
  };
}

describe("runFullDiagnosticsSuite", () => {
  it("runs calibration, Mode B, and Mode A, and writes one unified report when calibration passes", async () => {
    const storage = new FakeDiagnosticsStorageAdapter();
    const { report, reportPath } = await runFullDiagnosticsSuite(options({ storage }));

    expect(report.calibration).toEqual({
      injectedLatencyMs: 80,
      measuredMs: expect.any(Number),
      withinTolerance: true,
    });
    expect(report.scenario).not.toBeNull();
    expect(report.analysis).not.toBeNull();
    expect(report.loopback).not.toBeNull();
    expect(report.loopbackAnalysis).not.toBeNull();
    expect(storage.readReport(reportPath)).toEqual(report);
    expect(storage.writtenPaths()).toEqual([reportPath]);
  });

  it("gives the report's Project a Guide reflecting the shared Metronome", async () => {
    const { report } = await runFullDiagnosticsSuite(options());

    expect(report.project?.guide).not.toBeNull();
    expect(report.project?.guide?.includeInMonitorMix).toBe(true);
  });

  it("gives Mode B and Mode A identical expected-beat-times, read from the shared Metronome", async () => {
    const { report } = await runFullDiagnosticsSuite(options());

    expect(report.analysis!.tracks[0].expectedBeatTimesMs).toEqual(
      report.loopbackAnalysis!.track.expectedBeatTimesMs
    );
    expect(report.analysis!.tracks[0].expectedBeatTimesMs).toHaveLength(DEFAULT_FULL_SUITE_PARAMS.beatCount);
  });

  it("drives Mode B against a fresh SyntheticCaptureAdapter and Mode A against the given real capture adapter", async () => {
    const capture = new FakeCaptureAdapter();
    const { report } = await runFullDiagnosticsSuite(options({ capture }));

    // Mode A's Take came from the real capture adapter given to the suite.
    expect(capture.stoppedMediaRefs).toHaveLength(1);
    expect(report.loopback).toEqual({
      bpm: DEFAULT_FULL_SUITE_PARAMS.tempoBpm,
      beatsPerBar: DEFAULT_FULL_SUITE_PARAMS.beatsPerBar,
      beatCount: DEFAULT_FULL_SUITE_PARAMS.beatCount,
    });
  });

  it("aborts before Mode B/Mode A run and writes no report when calibration fails", async () => {
    const storage = new FakeDiagnosticsStorageAdapter();
    const capture = new FakeCaptureAdapter();
    // No calibration signal at all -> "no beats detected" -> fails tolerance.
    const decode = vi.fn(async () => ({ samples: new Float32Array(100), sampleRate: SYNTHETIC_SAMPLE_RATE }));

    await expect(runFullDiagnosticsSuite(options({ storage, capture, decode }))).rejects.toThrow(
      CalibrationFailedError
    );

    expect(storage.writtenPaths()).toEqual([]);
    expect(capture.stoppedMediaRefs).toEqual([]);
  });

  it("surfaces the calibration result on the thrown error", async () => {
    const decode = vi.fn(async () => ({ samples: new Float32Array(100), sampleRate: SYNTHETIC_SAMPLE_RATE }));

    await expect(runFullDiagnosticsSuite(options({ decode }))).rejects.toMatchObject({
      calibration: { injectedLatencyMs: 80, measuredMs: null, withinTolerance: false },
    });
  });

  it("respects a configured trackCount/tempo/beat grid", async () => {
    const decode = decodeWithCalibrationSignal(80, {
      trackCount: 2,
      tempoBpm: 120,
      beatsPerBar: 4,
      beatCount: 8,
    });
    const { report } = await runFullDiagnosticsSuite(
      options({ decode, params: { trackCount: 2, tempoBpm: 120, beatCount: 8 } })
    );

    expect(report.scenario).toEqual({
      trackCount: 2,
      tempoBpm: 120,
      beatsPerBar: 4,
      beatCount: 8,
      armDelayMs: 0,
      simulatedLatencyMs: 0,
    });
    expect(report.analysis!.tracks).toHaveLength(2);
  });
});
