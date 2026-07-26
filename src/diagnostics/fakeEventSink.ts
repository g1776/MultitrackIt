import { EngineEventLog } from "./eventLog";

/**
 * Deterministic sink for tests: stamps events `stepMs` apart starting at
 * zero, so assertions can name exact times without a real clock.
 *
 * A factory over an ordinary `EngineEventLog` rather than a subclass of one:
 * the only thing a fake sink changes is the clock, which is already a
 * constructor parameter, so there is nothing left for a subclass to be.
 */
export function createFakeEventSink(stepMs = 1): EngineEventLog {
  let tick = -stepMs;
  return new EngineEventLog(() => (tick += stepMs));
}
