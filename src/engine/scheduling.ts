import type { PlaybackSchedule, PlaybackScheduleEntry } from "./adapters";
import type { Guide, Track, TrackId } from "./types";

/**
 * A Take reduced to just what's needed to schedule it for playback, before
 * offsets are normalized into a concrete `startAtMs`.
 */
export interface ScheduleInput {
  takeId: string;
  mediaRef: string;
  /** The Take's stored Offset (ms), signed, relative to the Project timeline. */
  offsetMs: number;
  volume: number;
  muted: boolean;
}

/**
 * Pure sync/offset computation: given a set of Takes with signed Offsets,
 * compute the schedule of when each should start relative to playback
 * start (`startAtMs`), which must never be negative (a schedule can't start
 * a Take before playback begins). A Take's Offset is used directly as its
 * `startAtMs` whenever every Offset in the set is already >= 0. If any
 * Offset is negative, the whole set is shifted forward by just enough to
 * bring the earliest Take to 0, preserving every Take's timing relative to
 * the others so sync is unaffected.
 *
 * Decoupled from Electron/DOM APIs so it can be unit-tested as pure logic
 * per the spec (assert the computed schedule, not real wall-clock audio).
 */
export function computePlaybackSchedule(inputs: ScheduleInput[]): PlaybackSchedule {
  if (inputs.length === 0) return { entries: [] };

  const earliestOffsetMs = Math.min(...inputs.map((i) => i.offsetMs));
  const shiftMs = earliestOffsetMs < 0 ? -earliestOffsetMs : 0;
  const entries: PlaybackScheduleEntry[] = inputs.map((input) => ({
    takeId: input.takeId,
    mediaRef: input.mediaRef,
    startAtMs: input.offsetMs + shiftMs,
    volume: input.volume,
    muted: input.muted,
  }));

  return { entries };
}

/**
 * Which Tracks should be audible during playback, honoring solo (soloed
 * Tracks exclusively audible when any exist) and mute, and excluding Tracks
 * with no selected Take (nothing to play).
 */
export function selectAudibleTracks(tracks: Track[]): Track[] {
  const soloedTracks = tracks.filter((t) => t.solo);
  const candidates = soloedTracks.length > 0 ? soloedTracks : tracks;
  return candidates.filter((t) => !t.mute && t.selectedTakeId);
}

function scheduleInputsForTracks(
  tracks: Track[],
  levels: Map<TrackId, number>
): ScheduleInput[] {
  return selectAudibleTracks(tracks).map((track) => {
    const take = track.takes.find((t) => t.id === track.selectedTakeId)!;
    return {
      takeId: take.id,
      mediaRef: take.mediaRef,
      offsetMs: take.offsetMs,
      volume: levels.get(track.id) ?? 1,
      muted: false,
    };
  });
}

/**
 * Monitor Mix schedule played while recording a new Take: the selected
 * Takes of previously recorded Tracks, offset-corrected and sync'd, at
 * their Monitor Mix levels, plus the Guide (if any) at its own Monitor Mix
 * level, always starting at offset 0. The Track currently being recorded
 * onto (`recordingTrackId`) is excluded so the performer only hears prior
 * parts. The Guide is included here even though it's excluded from
 * composite playback, since Monitor Mix is recording-only.
 */
export function buildMonitorMixSchedule(
  tracks: Track[],
  guide: Guide | null,
  monitorMixLevels: Map<TrackId | "guide", number>,
  recordingTrackId: TrackId | undefined
): PlaybackSchedule {
  const otherTracks = recordingTrackId
    ? tracks.filter((t) => t.id !== recordingTrackId)
    : tracks;
  const inputs = scheduleInputsForTracks(otherTracks, monitorMixLevels);
  if (guide) {
    inputs.push({
      takeId: "guide",
      mediaRef: guide.mediaRef,
      offsetMs: 0,
      volume: monitorMixLevels.get("guide") ?? 1,
      muted: false,
    });
  }
  return computePlaybackSchedule(inputs);
}

/**
 * Composite playback schedule: all audible Tracks' selected Takes together,
 * offset-corrected and sync'd, at the given per-Track volume levels.
 */
export function buildCompositeSchedule(
  tracks: Track[],
  levels: Map<TrackId, number>
): PlaybackSchedule {
  return computePlaybackSchedule(scheduleInputsForTracks(tracks, levels));
}

/** One Track's position within a simple static video grid Layout. */
export interface GridCell {
  trackId: TrackId;
  row: number;
  col: number;
  rows: number;
  cols: number;
}

/**
 * Computes a simple static grid Layout: one cell per visible Track (audible
 * per solo/mute rules and having a selected Take), arranged into a
 * near-square grid, filled row-major.
 */
export function computeGridLayout(tracks: Track[]): GridCell[] {
  const visibleTracks = selectAudibleTracks(tracks);
  const count = visibleTracks.length;
  if (count === 0) return [];

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  return visibleTracks.map((track, index) => ({
    trackId: track.id,
    row: Math.floor(index / cols),
    col: index % cols,
    rows,
    cols,
  }));
}
