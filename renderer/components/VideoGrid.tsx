import { useEffect, useMemo, useRef } from "react";
import { computeGridDimensions, computeGridLayout } from "../../src/engine/scheduling";
import type { Track } from "../../src/engine/types";
import { useTransportStore } from "../store/useTransportStore";
import { captureAdapter } from "../store/engine";

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
 * startAtMs (see the isPlaying effect below) so the grid stays
 * offset-corrected and in sync with that audio.
 */
export function VideoGrid({ tracks }: { tracks: Track[] }) {
  const isRecording = useTransportStore((s) => s.isRecording);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const livePreviewTrackId = useTransportStore((s) => s.livePreviewTrackId);

  const gridLayout = useMemo(() => computeGridLayout(tracks), [tracks]);
  const gridVideoRefs = useRef(new Map<string, HTMLVideoElement>());

  // Drives each grid cell's <video> off the same startAtMs the audio-only
  // playback adapter uses, so the visible grid stays offset-corrected and in
  // sync with the audio instead of every cell naively starting at once.
  useEffect(() => {
    if (!isPlaying) {
      gridVideoRefs.current.forEach((video) => {
        video.pause();
        video.currentTime = 0;
      });
      return;
    }

    const timers = gridLayout.map((cell) => {
      const video = gridVideoRefs.current.get(cell.trackId);
      if (!video) return undefined;
      return setTimeout(() => void video.play(), cell.startAtMs);
    });

    return () => timers.forEach((timer) => timer && clearTimeout(timer));
  }, [isPlaying, gridLayout]);

  // Whether the Track currently being recorded onto needs its own live
  // preview cell — false once it has a completed Take of its own (recording
  // a re-take already appears via its existing gridLayout cell).
  const showLivePreview =
    isRecording &&
    livePreviewTrackId !== undefined &&
    !gridLayout.some((cell) => cell.trackId === livePreviewTrackId);
  const renderCellCount = gridLayout.length + (showLivePreview ? 1 : 0);
  const { rows: renderRows, cols: renderCols } = computeGridDimensions(renderCellCount);

  const livePreviewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Real-time self-view: attach the in-progress capture's live MediaStream
  // (not a finished mediaRef) so a new Track's cell shows video immediately
  // instead of only after stopping and reloading the Project.
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
  }, [showLivePreview]);

  if (renderCellCount === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${renderCols}, 1fr)`,
        gridTemplateRows: `repeat(${renderRows}, 1fr)`,
        gap: 8,
        marginTop: 16,
      }}
    >
      {gridLayout.map((cell, index) => {
        const cellTrack = tracks.find((t) => t.id === cell.trackId)!;
        const mediaRef = selectedTakeMediaRef(cellTrack);
        return (
          <div
            key={cell.trackId}
            style={{
              gridRow: Math.floor(index / renderCols) + 1,
              gridColumn: (index % renderCols) + 1,
              background: "#000",
              aspectRatio: "16 / 9",
            }}
          >
            {mediaRef && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={(el) => {
                  if (el) gridVideoRefs.current.set(cell.trackId, el);
                  else gridVideoRefs.current.delete(cell.trackId);
                }}
                src={mediaRef}
                muted
                playsInline
                style={{ width: "100%", height: "100%" }}
              />
            )}
          </div>
        );
      })}
      {showLivePreview &&
        (() => {
          const index = gridLayout.length;
          return (
            <div
              key="live-preview"
              style={{
                gridRow: Math.floor(index / renderCols) + 1,
                gridColumn: (index % renderCols) + 1,
                background: "#000",
                aspectRatio: "16 / 9",
              }}
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={livePreviewVideoRef} muted playsInline autoPlay style={{ width: "100%", height: "100%" }} />
            </div>
          );
        })()}
    </div>
  );
}
