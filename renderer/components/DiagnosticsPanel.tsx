import { useState } from "react";
import {
  captureAdapter,
  diagnosticsStorage,
  engine,
  engineEventLog,
  playbackAdapter,
} from "../store/engine";
import {
  buildReport,
  guideWouldBeSilentWhileRecording,
  summariseProject,
} from "../../src/diagnostics/report";

/**
 * The diagnostics instrument, deliberately separate from the recording UI
 * (ADR 0004): a hard boundary between the app and the thing measuring it, so
 * no diagnostics control can sit in the main toolbar silently affecting a
 * real recording session.
 *
 * Its one action writes what just happened — every lead-in and playback
 * event with a timestamp, and every schedule entry's computed start time and
 * originating Offset — to a report on disk.
 */
export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [writtenPath, setWrittenPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The log isn't reactive — it's an engine-side buffer, not app state, and
  // making it push updates would put a diagnostics concern in the recording
  // path. Re-reading on demand is enough for an instrument driven by hand.
  const [events, setEvents] = useState(() => engineEventLog.getEvents());

  const project = summariseProject(engine.getActiveProject());
  const guideSilent = guideWouldBeSilentWhileRecording(project);
  // Read at render (like the log itself) rather than held in state: it changes
  // only when a capture opens, and Refresh re-renders this panel.
  const audioProcessing = captureAdapter.getAudioProcessing();

  async function writeReport(): Promise<void> {
    setError(null);
    try {
      const report = buildReport(engineEventLog.getEvents(), {
        createdAt: new Date().toISOString(),
        project: summariseProject(engine.getActiveProject()),
        audioClock: playbackAdapter.getAudioClockSession() ?? null,
        audioProcessing: captureAdapter.getAudioProcessing() ?? null,
      });
      setWrittenPath(await diagnosticsStorage.writeReport(report));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="diagnostics">
      <h2>Diagnostics</h2>
      <p className="hint">
        Record a Take, then write a report of what happened during that pass. Reports are
        written to the gitignored <code>diagnostics/</code> directory at the repository root.
      </p>

      <div className="panel">
        <button onClick={() => void writeReport()} disabled={events.length === 0}>
          Write Report
        </button>
        <button onClick={() => setEvents(engineEventLog.getEvents())}>Refresh</button>
        <button
          onClick={() => {
            engineEventLog.clear();
            setEvents([]);
            setWrittenPath(null);
          }}
        >
          Clear Timeline
        </button>
        <button onClick={onClose}>Close</button>
      </div>

      <p className="value">
        {events.length === 0
          ? "No events recorded yet — record a Take or play back."
          : `${events.length} event(s) recorded.`}
      </p>
      {guideSilent && (
        <p className="hint">
          {project?.guide
            ? "The Guide is excluded from the Monitor Mix, so it won't sound while recording."
            : "No Guide imported."}{" "}
          A pass recorded this way exercises a different Offset path than normal use, so its
          numbers won't describe the case you're chasing.
        </p>
      )}
      {audioProcessing && audioProcessing.summary === "processed" && (
        <p className="hint">
          {audioProcessing.constraintsRequested
            ? `This device kept ${audioProcessing.stillActive.join(", ")} on despite being asked for unprocessed audio.`
            : `This device refused the unprocessed-audio request outright, so ${audioProcessing.stillActive.join(", ")} stayed on.`}{" "}
          Timing and level measured from these Takes describe the processing as much as the app.
        </p>
      )}
      {audioProcessing && audioProcessing.summary === "unknown" && (
        <p className="hint">
          This device didn't report {audioProcessing.unreported.join(", ")}, so whether it
          processed the audio is unknown. Timing and level measured from these Takes may describe
          the processing as much as the app.
        </p>
      )}
      {writtenPath && <p className="hint">Wrote {writtenPath}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
