import type { EngineEvent, EngineEventSink, TimestampedEngineEvent } from "../engine/events";

/**
 * An `EngineEventSink` that stamps each event from an injected clock and
 * keeps it, so a whole recording or playback pass can be read back
 * afterwards and written to a report.
 *
 * The clock is a constructor parameter rather than a second seam because
 * that is the whole reason timestamping lives in the sink: production passes
 * a reader of the real `AudioContext` clock, tests pass a deterministic
 * counter, and the engine stays clock-free either way (see `EngineEventSink`).
 */
export class EngineEventLog implements EngineEventSink {
  private events: TimestampedEngineEvent[] = [];

  /** @param nowMs Reads the current time in milliseconds on whatever clock this log stamps against. */
  constructor(private readonly nowMs: () => number) {}

  record(event: EngineEvent): void {
    this.events.push({ ...event, atMs: this.nowMs() });
  }

  /** Everything recorded so far, oldest first. */
  getEvents(): TimestampedEngineEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
