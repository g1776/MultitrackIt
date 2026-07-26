import { describe, it, expect, vi } from "vitest";
import { DEFAULT_LOOPBACK_PARAMS, runLoopbackScenario, type RunLoopbackScenarioOptions } from "./loopback";

function fakeAudioContext() {
  const destination = {};
  const sources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = [];
  return {
    destination,
    sampleRate: 48000,
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
      copyToChannel: vi.fn(),
      length,
      sampleRate,
    })),
    createBufferSource: vi.fn(() => {
      const source = { buffer: undefined, connect: vi.fn(), start: vi.fn() };
      sources.push(source);
      return source;
    }),
    _sources: sources,
  } as unknown as AudioContext & { _sources: typeof sources };
}

function fakeStream() {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }] } as unknown as MediaStream & { _stop: typeof stop };
}

function options(overrides: Partial<RunLoopbackScenarioOptions> = {}): RunLoopbackScenarioOptions {
  return {
    audioContext: fakeAudioContext(),
    openMicStream: vi.fn(async () => fakeStream()),
    recordStream: vi.fn(async () => "mediaRef://captured"),
    decode: vi.fn(async () => ({ samples: new Float32Array(100), sampleRate: 48000 })),
    sleep: vi.fn(async () => {}),
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
    expect(params).toEqual({ bpm: 120, beatsPerBar: 4, beatCount: 8 });
  });

  it("plays the signal through the given AudioContext's destination", async () => {
    const audioContext = fakeAudioContext();
    await runLoopbackScenario(options({ audioContext }));

    expect(audioContext.createBufferSource).toHaveBeenCalledTimes(1);
    const source = audioContext._sources[0];
    expect(source.connect).toHaveBeenCalledWith(audioContext.destination);
    expect(source.start).toHaveBeenCalledTimes(1);
  });

  it("records for the signal duration plus a tail, not just the signal duration", async () => {
    const recordStream = vi.fn(async (_stream: MediaStream, _durationMs: number) => "mediaRef://captured");
    await runLoopbackScenario(options({ recordStream, params: { bpm: 100, beatCount: 16 } }));

    const signalDurationMs = 16 * (60000 / 100);
    const [, durationMs] = recordStream.mock.calls[0];
    expect(durationMs).toBeGreaterThan(signalDurationMs);
  });

  it("releases the microphone stream once the run finishes", async () => {
    const stream = fakeStream();
    await runLoopbackScenario(options({ openMicStream: vi.fn(async () => stream) }));

    expect(stream.getTracks()[0].stop).toHaveBeenCalledTimes(1);
  });

  it("releases the microphone stream even when the run fails", async () => {
    const stream = fakeStream();
    const decode = vi.fn(async () => {
      throw new Error("decode failed");
    });

    await expect(
      runLoopbackScenario(options({ openMicStream: vi.fn(async () => stream), decode }))
    ).rejects.toThrow("decode failed");
    expect(stream.getTracks()[0].stop).toHaveBeenCalledTimes(1);
  });

  it("decodes the recorded media and analyses it against the expected beat grid", async () => {
    const { analysis } = await runLoopbackScenario(options());
    expect(analysis.track.expectedBeatTimesMs).toHaveLength(DEFAULT_LOOPBACK_PARAMS.beatCount);
  });

  it("reports no onsets detected, rather than a spurious offset, for a silent capture", async () => {
    const decode = vi.fn(async () => ({ samples: new Float32Array(48000), sampleRate: 48000 }));
    const { analysis } = await runLoopbackScenario(options({ decode }));

    expect(analysis.noOnsetsDetected).toBe(true);
    expect(analysis.roundTripLatencyMs).toBeNull();
  });

  it.each([{ bpm: 0 }, { beatsPerBar: 0 }, { beatCount: 0 }])(
    "rejects an invalid configuration %o",
    async (overrides) => {
      await expect(runLoopbackScenario(options({ params: overrides }))).rejects.toThrow();
    }
  );
});
