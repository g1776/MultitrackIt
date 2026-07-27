import { describe, it, expect, vi } from "vitest";
import { FakeCaptureAdapter, FakeCountInAdapter, FakePlaybackAdapter, fakeMetronomeAudio } from "../engine/fakeAdapters";
import { DEFAULT_LOOPBACK_PARAMS, runLoopbackScenario, type RunLoopbackScenarioOptions } from "./loopback";

/** Skips the real lead-in so tests run instantly, matching `scenario.test.ts`'s pattern. */
const FAST: Partial<RunLoopbackScenarioOptions> = {
  countInBars: 0,
  countInPaddingMs: 0,
  idleReleaseMs: 0,
  sleep: async () => {},
};

function options(overrides: Partial<RunLoopbackScenarioOptions> = {}): RunLoopbackScenarioOptions {
  return {
    capture: new FakeCaptureAdapter(),
    playback: new FakePlaybackAdapter(),
    countIn: new FakeCountInAdapter(),
    metronomeAudio: fakeMetronomeAudio,
    audioContext: { sampleRate: 48000 } as AudioContext,
    decode: vi.fn(async () => ({ samples: new Float32Array(100), sampleRate: 48000 })),
    ...FAST,
    ...overrides,
  };
}

describe("runLoopbackScenario", () => {
  it("reports the params a run was made with, for reproducibility", async () => {
    const { params } = await runLoopbackScenario(options());
    expect(params).toEqual(DEFAULT_LOOPBACK_PARAMS);
  });

  it("respects a configured bpm and beat count", async () => {
    const { params } = await runLoopbackScenario(
      options({ params: { bpm: 120, beatCount: 8 } })
    );
    expect(params).toEqual({ bpm: 120, beatsPerBar: 4, beatCount: 8, trackCount: 1 });
  });

  it("gives the ephemeral Project a real Metronome Guide, audible in Monitor Mix, matching its own tempo", async () => {
    const { project } = await runLoopbackScenario(options({ params: { bpm: 120, beatsPerBar: 3 } }));
    expect(project.tempoBpm).toBe(120);
    expect(project.beatsPerBar).toBe(3);
    expect(project.guide).not.toBeNull();
    expect(project.guide!.includeInMonitorMix).toBe(true);
    expect(project.guide!.metronomeSchedule).toBeDefined();
  });

  it("drives the real recordTake/stopRecording path with the given capture adapter, not ad hoc getUserMedia/MediaRecorder wiring", async () => {
    const capture = new FakeCaptureAdapter();
    const { project } = await runLoopbackScenario(options({ capture }));

    expect(capture.armCount).toBe(1);
    expect(capture.startedHandles).toHaveLength(1);
    expect(capture.stoppedMediaRefs).toHaveLength(1);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0].takes).toHaveLength(1);
    expect(project.tracks[0].takes[0].mediaRef).toBe(capture.stoppedMediaRefs[0]);
  });

  it("decodes the recorded Take and analyses it against the real Guide's own beat schedule", async () => {
    const decode = vi.fn(async () => ({ samples: new Float32Array(100), sampleRate: 48000 }));
    const { project, analysis } = await runLoopbackScenario(options({ decode }));

    expect(decode).toHaveBeenCalledWith(project.tracks[0].takes[0].mediaRef, expect.anything());
    expect(analysis.track.expectedBeatTimesMs).toHaveLength(DEFAULT_LOOPBACK_PARAMS.beatCount);
    expect(analysis.track.expectedBeatTimesMs).toEqual(
      project.guide!.metronomeSchedule!.slice(0, DEFAULT_LOOPBACK_PARAMS.beatCount).map((c) => c.atMs)
    );
  });

  it("reports no onsets detected, rather than a spurious offset, for a silent capture", async () => {
    const decode = vi.fn(async () => ({ samples: new Float32Array(48000), sampleRate: 48000 }));
    const { analysis } = await runLoopbackScenario(options({ decode }));

    expect(analysis.noOnsetsDetected).toBe(true);
    expect(analysis.roundTripLatencyMs).toBeNull();
  });

  it("waits for the signal duration plus a tail, not just the signal duration, before stopping capture", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await runLoopbackScenario(options({ sleep, params: { bpm: 100, beatCount: 16 } }));

    const signalDurationMs = 16 * (60000 / 100);
    expect(sleep).toHaveBeenCalledTimes(1);
    const [durationMs] = sleep.mock.calls[0];
    expect(durationMs).toBeGreaterThan(signalDurationMs);
  });

  it.each([{ bpm: 0 }, { beatsPerBar: 0 }, { beatCount: 0 }, { trackCount: 0 }, { trackCount: 1.5 }])(
    "rejects an invalid configuration %o",
    async (overrides) => {
      await expect(runLoopbackScenario(options({ params: overrides }))).rejects.toThrow();
    }
  );

  it("records trackCount Takes in sequence, each a fresh Track, monitoring every earlier one plus the Guide", async () => {
    const capture = new FakeCaptureAdapter();
    const { project, analyses } = await runLoopbackScenario(
      options({ capture, params: { trackCount: 3 } })
    );

    expect(capture.startedHandles).toHaveLength(3);
    expect(project.tracks).toHaveLength(3);
    expect(analyses).toHaveLength(3);
    // recordTake(undefined) always creates a fresh Track, and every prior
    // Track is already selected by the time the next is recorded — so by the
    // third Take, the first two Tracks are both eligible Monitor Mix entries.
    expect(project.tracks[2].id).not.toBe(project.tracks[0].id);
    expect(project.tracks[2].id).not.toBe(project.tracks[1].id);
  });

  it("analyses every recorded Take against the same shared Guide schedule, in recording order", async () => {
    const decode = vi
      .fn()
      .mockResolvedValueOnce({ samples: new Float32Array(100), sampleRate: 48000 })
      .mockResolvedValueOnce({ samples: new Float32Array(48000), sampleRate: 48000 });
    const { project, analyses, analysis } = await runLoopbackScenario(
      options({ decode, params: { trackCount: 2, beatCount: 4 } })
    );

    expect(analyses).toHaveLength(2);
    expect(analyses[0].track.expectedBeatTimesMs).toEqual(analyses[1].track.expectedBeatTimesMs);
    // The last analysis is the one `analysis` (singular) surfaces, matching
    // solo-take behaviour where `analysis`/`analyses[0]` are the same thing.
    expect(analysis).toBe(analyses[1]);
    expect(analyses[1].noOnsetsDetected).toBe(true);
    expect(decode).toHaveBeenNthCalledWith(1, project.tracks[0].takes[0].mediaRef, expect.anything());
    expect(decode).toHaveBeenNthCalledWith(2, project.tracks[1].takes[0].mediaRef, expect.anything());
  });
});
