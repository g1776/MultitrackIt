import type { PlaybackMixUpdate, PlaybackSchedule, PlaybackScheduleEntry } from "./adapters";
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

/** Whether a Track should be heard, honoring solo (exclusive when any Track is soloed) and mute. */
function isTrackAudible(tracks: Track[], track: Track): boolean {
  const anySoloed = tracks.some((t) => t.solo);
  return anySoloed ? track.solo : !track.mute;
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
 * Composite playback schedule: every Track with a selected Take, offset-
 * corrected and sync'd, at the given per-Track volume levels. Tracks that
 * aren't currently audible (per mute/solo) are included as muted entries
 * rather than omitted, so a schedule built once still has every Take's
 * element in sync and ready — toggling mute/solo later only needs to flip
 * `muted`/`volume` on an already-playing entry via `buildMixUpdates`,
 * instead of restarting or re-syncing playback.
 */
export function buildCompositeSchedule(
  tracks: Track[],
  levels: Map<TrackId, number>
): PlaybackSchedule {
  const inputs: ScheduleInput[] = tracks
    .filter((track) => track.selectedTakeId)
    .map((track) => {
      const take = track.takes.find((t) => t.id === track.selectedTakeId)!;
      return {
        takeId: take.id,
        mediaRef: take.mediaRef,
        offsetMs: take.offsetMs,
        volume: levels.get(track.id) ?? 1,
        muted: !isTrackAudible(tracks, track),
      };
    });
  return computePlaybackSchedule(inputs);
}

/**
 * Per-Take volume/muted values for all Tracks with a selected Take,
 * reflecting current mute/solo and Monitor Mix levels — the live update to
 * push to an already-playing composite schedule via `PlaybackAdapter.updateMix`.
 */
export function buildMixUpdates(
  tracks: Track[],
  levels: Map<TrackId, number>
): PlaybackMixUpdate[] {
  return tracks
    .filter((track) => track.selectedTakeId)
    .map((track) => ({
      takeId: track.selectedTakeId!,
      volume: levels.get(track.id) ?? 1,
      muted: !isTrackAudible(tracks, track),
    }));
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
