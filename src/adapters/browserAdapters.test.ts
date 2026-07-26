import { describe, it, expect, afterEach, vi } from "vitest";
import { openUnprocessedStream, readAudioProcessing } from "./browserAdapters";
import { UNPROCESSED_AUDIO_CONSTRAINTS } from "../diagnostics/audioProcessing";

/**
 * Covers only the constraint-request/fallback control flow, not real
 * capture timing — vitest's `node` environment has no `AudioContext` or
 * `HTMLVideoElement`, and ADR 0004 is explicit that a headless test of that
 * suspect layer would pass regardless of a real bug. `getUserMedia` and a
 * granted track's `getSettings()` carry no such risk: they're a function
 * call and a plain object, faked here without touching the browser AV stack.
 */
function stubMediaDevices(getUserMedia: typeof navigator.mediaDevices.getUserMedia): void {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openUnprocessedStream", () => {
  it("asks for the unprocessed constraints and reports the request as made", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    const result = await openUnprocessedStream();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: UNPROCESSED_AUDIO_CONSTRAINTS,
      video: true,
    });
    expect(result).toEqual({ stream, constraintsRequested: true });
  });

  it("falls back to browser defaults, still acquiring the device, when the constraints are refused", async () => {
    const stream = {} as MediaStream;
    const overconstrained = Object.assign(new Error("refused"), {
      name: "OverconstrainedError",
    });
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(overconstrained)
      .mockResolvedValueOnce(stream);
    stubMediaDevices(getUserMedia);

    const result = await openUnprocessedStream();

    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true, video: true });
    expect(result).toEqual({ stream, constraintsRequested: false });
  });

  it("still rejects a plain permission denial rather than retrying it", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    stubMediaDevices(getUserMedia);

    await expect(openUnprocessedStream()).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("readAudioProcessing", () => {
  it("reads the granted audio track's settings back, rather than assuming the request applied", () => {
    const stream = {
      getAudioTracks: () => [{ getSettings: () => ({ echoCancellation: true }) }],
    } as unknown as MediaStream;

    const state = readAudioProcessing(stream, true);

    expect(state.controls.echoCancellation.actualEnabled).toBe(true);
  });

  it("has nothing to read when the stream has no audio track", () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream;

    const state = readAudioProcessing(stream, true);

    expect(state.summary).toBe("unknown");
  });
});
