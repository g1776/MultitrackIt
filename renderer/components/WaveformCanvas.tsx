import { useEffect, useRef } from "react";
import { computeWaveformCanvasLayout } from "../../src/diagnostics/waveformCanvasLayout";
import type { AnalysisResult } from "../../src/diagnostics/types";

const WIDTH = 900;
const HEIGHT_PER_TRACK = 80;
const GRIDLINE_COLOR = "#c0c0c0";
const ONSET_COLOR = "#b00020";
const TRACK_COLORS = ["#1a6fb0", "#0f8a5f", "#a05a00", "#7a3fa0", "#b03f6a"];

/**
 * Stacked, beat-gridded waveform canvas (issue #20, ADR 0004): one row per
 * Track, sharing a single time axis, so a Track that's ahead or behind is
 * visible at a glance rather than only in the report's numbers. Renders from
 * the same `AnalysisResult` the report is written from — the same one, not a
 * copy — so the canvas and the file can never disagree.
 *
 * Deliberately lives only in the Diagnostics panel; the normal recording UI
 * is unchanged.
 */
export function WaveformCanvas({ analysis }: { analysis: AnalysisResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const height = analysis.tracks.length * HEIGHT_PER_TRACK;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const layout = computeWaveformCanvasLayout(analysis, WIDTH, height);

    ctx.clearRect(0, 0, WIDTH, height);

    layout.rows.forEach((row, rowIndex) => {
      const color = TRACK_COLORS[rowIndex % TRACK_COLORS.length];

      if (rowIndex > 0) {
        ctx.strokeStyle = "#e0e0e0";
        ctx.beginPath();
        ctx.moveTo(0, rowIndex * row.rowHeight);
        ctx.lineTo(WIDTH, rowIndex * row.rowHeight);
        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (const bar of row.bars) {
        ctx.beginPath();
        ctx.moveTo(bar.x, row.centerY - bar.halfHeight);
        ctx.lineTo(bar.x, row.centerY + bar.halfHeight);
        ctx.stroke();
      }

      ctx.fillStyle = ONSET_COLOR;
      for (const onset of row.onsets) {
        ctx.fillRect(onset.x - 1, row.centerY - row.rowHeight / 2 + 2, 2, row.rowHeight - 4);
      }
    });

    ctx.strokeStyle = GRIDLINE_COLOR;
    ctx.lineWidth = 1;
    for (const x of layout.gridlineXs) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [analysis, height]);

  return (
    <div className="waveform-canvas">
      <canvas ref={canvasRef} width={WIDTH} height={height} />
      <ul className="waveform-canvas__legend">
        {analysis.tracks.map((track, i) => (
          <li key={track.trackId} style={{ color: TRACK_COLORS[i % TRACK_COLORS.length] }}>
            {track.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
