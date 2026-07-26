import type { EngineEvent, TimestampedEngineEvent } from "../engine/events";
import type { Project } from "../engine/types";
import type {
  AudioClockSession,
  AudioProcessingState,
  CountInMeasurement,
  DiagnosticsReport,
  IntervalMeasurement,
  ProjectSummary,
} from "./types";

export interface ReportContext {
  /** ISO 8601 wall-clock time the report was written. */
  createdAt: string;
  project: ProjectSummary | null;
  audioClock: AudioClockSession | null;
  /** What the capture adapter read back off the granted track; null if nothing has been captured. */
  audioProcessing: AudioProcessingState | null;
}

/**
 * Reduces the active Project to what a report says about it. Shared by the
 * report and by the panel's own sanity check, so a warning on screen and the
 * file written next to it can never disagree about whether there was a Guide.
 */
export function summariseProject(project: Project | null): ProjectSummary | null {
  if (!project) return null;
  return {
    name: project.name,
    tempoBpm: project.tempoBpm,
    beatsPerBar: project.beatsPerBar,
    guide: project.guide && {
      includeInMonitorMix: project.guide.includeInMonitorMix,
      includeInMixdown: project.guide.includeInMixdown,
    },
  };
}

/**
 * Whether this Project would produce a pass with no Guide sounding — either
 * because none was imported or generated, or because it's excluded from the
 * Monitor Mix. Worth surfacing before a report is written: it is the most
 * likely way to record a diagnostics pass that measures the wrong thing.
 */
export function guideWouldBeSilentWhileRecording(project: ProjectSummary | null): boolean {
  return !project?.guide?.includeInMonitorMix;
}

/**
 * The *most recent* event of a type. A report is written straight after a
 * pass and says what just happened, so when a log spans several passes the
 * summary describes the latest one rather than whichever came first.
 */
function findLastEvent<T extends EngineEvent["type"]>(
  events: TimestampedEngineEvent[],
  type: T
): Extract<TimestampedEngineEvent, { type: T }> | undefined {
  const matching = events.filter(
    (e): e is Extract<TimestampedEngineEvent, { type: T }> => e.type === type
  );
  return matching.at(-1);
}

/**
 * Elapsed time between a started/ended pair, or null if the pass never
 * reached both — an abandoned recording produces a partial timeline, and
 * reporting a missing interval as zero would read as a measurement.
 */
function elapsedMs(
  events: TimestampedEngineEvent[],
  startType: EngineEvent["type"],
  endType: EngineEvent["type"]
): number | null {
  const start = findLastEvent(events, startType);
  if (!start) return null;
  // The first matching end *after* that start, not the last one overall: a
  // later pass's end must never be paired with this pass's start.
  const end = events.find((e) => e.type === endType && e.atMs >= start.atMs);
  return end ? end.atMs - start.atMs : null;
}

/**
 * Summarises a pass's event timeline into a report. Pure: the timestamps,
 * the wall clock, and the file it ends up in all belong to callers, so what
 * a report says about a timeline can be asserted without any of them.
 *
 * A log covering several passes carries all of them in `events`; the
 * summary describes the *latest* lead-in, which is the one a report written
 * straight after a Take is about.
 */
export function buildReport(
  events: TimestampedEngineEvent[],
  context: ReportContext
): DiagnosticsReport {
  const countInStarted = findLastEvent(events, "count-in-started");
  const paddingStarted = findLastEvent(events, "padding-started");

  const padding: IntervalMeasurement = {
    requestedMs: paddingStarted?.requestedDurationMs ?? null,
    actualMs: elapsedMs(events, "padding-started", "padding-ended"),
  };

  const countIn: CountInMeasurement = {
    requestedMs: countInStarted?.requestedDurationMs ?? null,
    actualMs: elapsedMs(events, "count-in-started", "count-in-ended"),
    bars: countInStarted?.bars ?? null,
    beats: countInStarted?.beats ?? null,
  };

  // Reuses the same start/end pairing as the intervals above, so a pass that
  // never reached capture can't be paired with an earlier pass's capture.
  const captureStart = {
    delayAfterCountInMs: elapsedMs(events, "count-in-ended", "capture-started"),
  };

  return {
    createdAt: context.createdAt,
    project: context.project,
    audioClock: context.audioClock,
    audioProcessing: context.audioProcessing,
    padding,
    countIn,
    captureStart,
    events,
  };
}

/**
 * File name for a report: an ISO timestamp, with the characters Windows
 * forbids in a path replaced, so reports sort chronologically by name and
 * one run never overwrites another.
 */
export function reportFileName(createdAt: string): string {
  return `report-${createdAt.replace(/[:.]/g, "-")}.json`;
}
