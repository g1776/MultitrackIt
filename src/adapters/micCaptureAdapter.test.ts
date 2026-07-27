import { describe, it, expect, afterEach, vi } from "vitest";
import { openMicStream } from "./micCaptureAdapter";

/**
 * Covers only the constraint-request/fallback control flow, not real capture
 * timing — mirrors `browserAdapters.test.ts`'s `openUnprocessedStream` tests,
 * for the same reason (ADR 0004): a headless test of real MediaRecorder
 * timing would pass regardless of a real bug, but `getUserMedia`'s control
 * flow is a plain function call, faked here without touching the browser AV
 * stack.
 */
function stubMediaDevices(getUserMedia: typeof navigator.mediaDevices.getUserMedia): void {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openMicStream", () => {
  it("asks for unprocessed, audio-only audio", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    const result = await openMicStream();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
    expect(result).toBe(stream);
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

    const result = await openMicStream();

    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
    expect(result).toBe(stream);
  });

  it("still rejects a plain permission denial rather than retrying it", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    stubMediaDevices(getUserMedia);

    await expect(openMicStream()).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
