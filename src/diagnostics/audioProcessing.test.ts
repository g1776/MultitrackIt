import { describe, it, expect } from "vitest";
import { UNPROCESSED_AUDIO_CONSTRAINTS, describeAudioProcessing } from "./audioProcessing";

describe("UNPROCESSED_AUDIO_CONSTRAINTS", () => {
  it("asks for every voice-call processor off", () => {
    expect(UNPROCESSED_AUDIO_CONSTRAINTS).toEqual({
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    });
  });
});

describe("describeAudioProcessing", () => {
  it("reports a device that granted everything asked for as unprocessed", () => {
    const state = describeAudioProcessing({
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    });

    expect(state.summary).toBe("unprocessed");
    expect(state.controls.echoCancellation).toEqual({
      requestedEnabled: false,
      actualEnabled: false,
      honoured: true,
    });
  });

  it("says a refused constraint is still active rather than what was asked for", () => {
    const state = describeAudioProcessing({
      echoCancellation: true,
      autoGainControl: false,
      noiseSuppression: false,
    });

    expect(state.controls.echoCancellation).toEqual({
      requestedEnabled: false,
      actualEnabled: true,
      honoured: false,
    });
    expect(state.summary).toBe("processed");
  });

  it("names every processor still active, not just the first", () => {
    const state = describeAudioProcessing({
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: false,
    });

    expect(state.stillActive).toEqual(["echoCancellation", "autoGainControl"]);
  });

  it("has nothing to list when nothing is active", () => {
    const state = describeAudioProcessing(UNPROCESSED_AUDIO_CONSTRAINTS);

    expect(state.stillActive).toEqual([]);
  });

  it("distinguishes a processor the device never reported from one it disabled", () => {
    const state = describeAudioProcessing({ echoCancellation: false });

    expect(state.controls.autoGainControl).toEqual({
      requestedEnabled: false,
      actualEnabled: null,
      honoured: null,
    });
    // An unreported control is not evidence of a clean capture: a report that
    // called this "unprocessed" would be asserting something it never read.
    expect(state.summary).toBe("unknown");
    expect(state.unreported).toEqual(["autoGainControl", "noiseSuppression"]);
  });

  it("prefers 'processed' over 'unknown' when something is known to be active", () => {
    const state = describeAudioProcessing({ autoGainControl: true });

    expect(state.summary).toBe("processed");
  });

  it("reports a capture with no audio track's settings at all as unknown", () => {
    const state = describeAudioProcessing(null);

    expect(state.summary).toBe("unknown");
    expect(state.controls.noiseSuppression.actualEnabled).toBeNull();
    expect(state.unreported).toEqual([
      "echoCancellation",
      "autoGainControl",
      "noiseSuppression",
    ]);
  });

  it("records that the unprocessed request itself was refused, when it was", () => {
    const state = describeAudioProcessing(
      { echoCancellation: true, autoGainControl: true, noiseSuppression: true },
      { constraintsRequested: false }
    );

    // The device wouldn't accept the constrained request at all, so capture
    // fell back to defaults — the report must not claim we asked for these off.
    expect(state.constraintsRequested).toBe(false);
    expect(state.controls.echoCancellation.requestedEnabled).toBeNull();
    expect(state.controls.echoCancellation.honoured).toBeNull();
    expect(state.summary).toBe("processed");
  });
});
