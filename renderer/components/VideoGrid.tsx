import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { computeGridDimensions, computeGridLayout } from "../../src/engine/scheduling";
import type { Track } from "../../src/engine/types";
import { useTransportStore } from "../store/useTransportStore";
import { captureAdapter, engine, playbackAdapter } from "../store/engine";

function selectedTakeMediaRef(track: Track): string | undefined {
  return track.takes.find((t) => t.id === track.selectedTakeId)?.mediaRef;
}

/**
 * Composite video grid: one cell per visible Track, laid out via the pure
 * computeGridLayout, plus (while recording onto a new or not-yet-completed
 * Track) a live preview cell showing the in-progress capture in real time.
 * Positions are recomputed via computeGridDimensions against the combined
 * cell count rather than gridLayout's own row/col, since adding the live
 * cell can change the grid's shape (e.g. 1 recorded + 1 live -> 1x2, not
 * gridLayout's 1x1). Video is rendered muted here since audio for
 * composite/monitor playback is driven separately by the engine's playback
 * adapter; each recorded cell's own start is scheduled off the same
 * startAtMs (see the isPlaying/isRecording effect below) so the grid stays
 * offset-corrected and in sync with that audio during both composite
 * playback and while monitoring previously recorded Tracks during a new
 * recording.
 */
export function VideoGrid({ tracks }: { tracks: Track[] }) {
  const isRecording = useTransportStore((s) => s.isRecording);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const recordingTrackId = useTransportStore((s) => s.recordingTrackId);
  const livePreviewTrackId = useTransportStore((s) => s.livePreviewTrackId);

  const gridLayout = useMemo(() => computeGridLayout(tracks), [tracks]);
  const gridVideoRefs = useRef(new Map<string, HTMLVideoElement>());

  // Drives each grid cell's <video> off the same shared AudioContext clock
  // the audio-only playback adapter schedules its graph against (via
  // getVideoAnchor), rather than each cell running its own independent
  // setTimeout off startAtMs — so the visible grid stays anchored to the
  // same clock as the audio instead of drifting against it over a session
  // (ADR 0002; folds in and supersedes #11). Runs during recording too (not
  // just composite "Play All Tracks"): the engine already starts a separate
  // hidden monitor-mix playback for the *audio* of previously recorded
  // Tracks as soon as recording starts, but that's a parallel, off-DOM
  // `<video>` element decoupled from the grid's own cells — without this,
  // the grid's video stayed paused throughout recording. The Track
  // currently being recorded onto is excluded even if it already has a cell
  // from an earlier Take (a re-take), since monitoring your own
  // about-to-be-replaced previous Take isn't meaningful.
  useEffect(() => {
    if (!isPlaying && !isRecording) {
      gridVideoRefs.current.forEach((video) => {
        video.pause();
        video.currentTime = 0;
      });
      return;
    }

    const handle = isRecording
      ? engine.getActiveMonitorPlaybackHandle()
      : engine.getActivePlaybackHandle();
    // The audio-only playback adapter has always already been started by
    // this point (recordTake/play both await it before the store sets
    // isRecording/isPlaying), so a missing handle/delay here means there's
    // nothing to stay in sync with yet — skip rather than fall back to an
    // independent, un-anchored timer.
    if (!handle) return;

    const timers = gridLayout
      .filter((cell) => cell.trackId !== recordingTrackId)
      .map((cell) => {
        const video = gridVideoRefs.current.get(cell.trackId);
        const delayMs = playbackAdapter.getScheduledStartDelayMs(handle, cell.startAtMs);
        if (!video || delayMs === undefined) return undefined;
        return setTimeout(() => void video.play(), delayMs);
      });

    return () => timers.forEach((timer) => timer && clearTimeout(timer));
  }, [isPlaying, isRecording, recordingTrackId, gridLayout]);

  // The cells to render, in grid order: one per Track in the Layout, plus a
  // trailing cell for a Track being recorded onto for the first time (it has
  // no selected Take yet, so computeGridLayout gives it no cell). A re-take
  // does *not* get a trailing cell — it takes over the Track's existing cell,
  // so the in-progress Take appears in the position that Track already
  // occupies rather than jumping to the end of the grid and reshaping it.
  const showLivePreview = isRecording && livePreviewTrackId !== undefined;
  const livePreviewCellIndex = gridLayout.findIndex((cell) => cell.trackId === livePreviewTrackId);
  const hasTrailingLiveCell = showLivePreview && livePreviewCellIndex === -1;

  const renderCells: { key: string; trackId: string; isLive: boolean }[] = [
    ...gridLayout.map((cell) => ({
      key: cell.trackId,
      trackId: cell.trackId,
      isLive: showLivePreview && cell.trackId === livePreviewTrackId,
    })),
    ...(hasTrailingLiveCell ? [{ key: "live-preview", trackId: livePreviewTrackId!, isLive: true }] : []),
  ];
  const renderCellCount = renderCells.length;
  const { rows: renderRows, cols: renderCols } = computeGridDimensions(renderCellCount);

  const livePreviewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Real-time self-view: attach the in-progress capture's live MediaStream
  // (not a finished mediaRef) so the recording Track's cell shows video
  // immediately instead of only after stopping and reloading the Project.
  // Re-runs when the live cell moves between a Track's own grid position and
  // the trailing new-Track cell, since that is a different DOM element.
  useEffect(() => {
    const video = livePreviewVideoRef.current;
    if (!showLivePreview || !video) return;

    const stream = captureAdapter.getActiveStream();
    if (!stream) return;
    video.srcObject = stream;
    void video.play();

    return () => {
      video.srcObject = null;
    };
  }, [showLivePreview, livePreviewTrackId, hasTrailingLiveCell]);

  if (renderCellCount === 0) return null;

  return (
    <div
      className="video-grid"
      // Computed layout, not cosmetics: the grid's shape and its overall
      // aspect ratio both depend on the cell count, so they stay inline while
      // the cosmetic rules live in global.css. --grid-aspect is the whole
      // grid's ratio (16:9 cells tiled renderCols x renderRows); global.css
      // uses it to size the grid to fit inside its pane in both dimensions.
      style={
        {
          gridTemplateColumns: `repeat(${renderCols}, 1fr)`,
          gridTemplateRows: `repeat(${renderRows}, 1fr)`,
          "--grid-aspect": `${(renderCols * 16) / (renderRows * 9)}`,
        } as CSSProperties
      }
    >
      {renderCells.map((cell) => {
        const cellTrack = tracks.find((t) => t.id === cell.trackId);
        const mediaRef = cellTrack && selectedTakeMediaRef(cellTrack);
        return (
          <div key={cell.key} className="video-grid__cell">
            {cell.isLive ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video ref={livePreviewVideoRef} muted playsInline autoPlay />
            ) : (
              mediaRef && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  ref={(el) => {
                    if (el) gridVideoRefs.current.set(cell.trackId, el);
                    else gridVideoRefs.current.delete(cell.trackId);
                  }}
                  src={mediaRef}
                  muted
                  playsInline
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
