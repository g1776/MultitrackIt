import { describe, it, expect } from "vitest";
import { SyntheticCaptureAdapter } from "./syntheticCaptureAdapter";

const PARAMS = { bpm: 100, beatsPerBar: 4, beatCount: 4 };

describe("SyntheticCaptureAdapter", () => {
  it("starts unarmed", () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    expect(adapter.isArmed()).toBe(false);
  });

  it("becomes armed after arm() resolves", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();
    expect(adapter.isArmed()).toBe(true);
  });

  it("refuses to start capture while unarmed", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await expect(adapter.startCapture()).rejects.toThrow(/unarmed/);
  });

  it("disarm releases the device", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();
    await adapter.disarm();
    expect(adapter.isArmed()).toBe(false);
    await expect(adapter.startCapture()).rejects.toThrow(/unarmed/);
  });

  it("simulates a configurable acquisition delay before arm() resolves", async () => {
    const adapter = new SyntheticCaptureAdapter({ ...PARAMS, armDelayMs: 20 });
    const start = Date.now();
    await adapter.arm();
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it("issues a distinct capture handle per startCapture call", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();
    const first = await adapter.startCapture();
    await adapter.stopCapture(first);
    const second = await adapter.startCapture();
    expect(second.id).not.toBe(first.id);
  });

  it("fabricates a playable media reference from stopCapture", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();
    const handle = await adapter.startCapture();
    const mediaRef = await adapter.stopCapture(handle);
    expect(typeof mediaRef).toBe("string");
    expect(mediaRef.length).toBeGreaterThan(0);
  });

  it("fabricates a distinct signal (a different mediaRef) for each successive Take", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();

    const first = await adapter.stopCapture(await adapter.startCapture());
    const second = await adapter.stopCapture(await adapter.startCapture());
    const third = await adapter.stopCapture(await adapter.startCapture());

    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("reports zero simulated latency by default", async () => {
    const adapter = new SyntheticCaptureAdapter(PARAMS);
    await adapter.arm();
    await adapter.stopCapture(await adapter.startCapture());
    expect(adapter.getLatencyMs()).toBe(0);
  });

  it("reports a configured simulated latency through the same latency-estimate method", async () => {
    const adapter = new SyntheticCaptureAdapter({ ...PARAMS, simulatedLatencyMs: 45 });
    await adapter.arm();
    await adapter.stopCapture(await adapter.startCapture());
    expect(adapter.getLatencyMs()).toBe(45);
  });

  it("shifts every fabricated onset later by the configured simulated latency", async () => {
    const adapter = new SyntheticCaptureAdapter({ ...PARAMS, simulatedLatencyMs: 50 });
    await adapter.arm();
    const withLatency = await adapter.stopCapture(await adapter.startCapture());

    const plain = new SyntheticCaptureAdapter(PARAMS);
    await plain.arm();
    const withoutLatency = await plain.stopCapture(await plain.startCapture());

    expect(withLatency).not.toBe(withoutLatency);
  });
});
