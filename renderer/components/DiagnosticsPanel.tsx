import { useState } from "react";
import {
  captureAdapter,
  countInAdapter,
  diagnosticsStorage,
  engine,
  engineEventLog,
  micCaptureAdapter,
  playbackAdapter,
} from "../store/engine";
import {
  buildReport,
  guideWouldBeSilentWhileRecording,
  summariseProject,
} from "../../src/diagnostics/report";
import { EngineEventLog } from "../../src/diagnostics/eventLog";
import { generateMetronomeGuideAudio } from "../../src/adapters/metronomeAudio";
import {
  analyseScenarioResult,
  DEFAULT_SCENARIO_PARAMS,
  runSyntheticScenario,
  type ScenarioParams,
  type ScenarioProgress,
} from "../../src/diagnostics/scenario";
import {
  DEFAULT_LOOPBACK_PARAMS,
  runLoopbackScenario,
  type LoopbackParams,
} from "../../src/diagnostics/loopback";
import { runFullDiagnosticsSuite } from "../../src/diagnostics/fullSuite";
import type {
  AnalysisResult,
  LoopbackAnalysisResult,
} from "../../src/diagnostics/types";
import { WaveformCanvas } from "./WaveformCanvas";

type ConfigurableScenarioParams = Pick<
  ScenarioParams,
  "trackCount" | "tempoBpm" | "beatCount" | "simulatedLatencyMs"
>;

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

  const [scenarioParams, setScenarioParams] =
    useState<ConfigurableScenarioParams>({
      trackCount: DEFAULT_SCENARIO_PARAMS.trackCount,
      tempoBpm: DEFAULT_SCENARIO_PARAMS.tempoBpm,
      beatCount: DEFAULT_SCENARIO_PARAMS.beatCount,
      simulatedLatencyMs: DEFAULT_SCENARIO_PARAMS.simulatedLatencyMs,
    });
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [scenarioProgress, setScenarioProgress] =
    useState<ScenarioProgress | null>(null);
  const [scenarioWrittenPath, setScenarioWrittenPath] = useState<string | null>(
    null,
  );
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioAnalysis, setScenarioAnalysis] =
    useState<AnalysisResult | null>(null);

  const [loopbackParams, setLoopbackParams] = useState<LoopbackParams>(
    DEFAULT_LOOPBACK_PARAMS,
  );
  const [loopbackRunning, setLoopbackRunning] = useState(false);
  const [loopbackWrittenPath, setLoopbackWrittenPath] = useState<string | null>(
    null,
  );
  const [loopbackError, setLoopbackError] = useState<string | null>(null);
  const [loopbackAnalysis, setLoopbackAnalysis] =
    useState<LoopbackAnalysisResult | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fullSuiteRunning, setFullSuiteRunning] = useState(false);
  const [fullSuiteWrittenPath, setFullSuiteWrittenPath] = useState<
    string | null
  >(null);
  const [fullSuiteError, setFullSuiteError] = useState<string | null>(null);

  const project = summariseProject(engine.getActiveProject());
  const guideSilent = guideWouldBeSilentWhileRecording(project);
  // Read at render (like the log itself) rather than held in state: it changes
  // only when a capture opens, and Refresh re-renders this panel.
  const audioProcessing = captureAdapter.getAudioProcessing();

  /**
   * Runs the full one-click suite (#29) with fixed defaults matching today's
   * Mode B defaults: calibration → Mode B → Mode A → one unified report.
   * A `CalibrationFailedError` is surfaced with its specific injected-vs-
   * measured numbers rather than as a generic failure, since a calibration
   * failure means the harness itself isn't trustworthy yet, not that the app
   * has a sync bug.
   */
  async function runFullSuite(): Promise<void> {
    setFullSuiteError(null);
    setFullSuiteWrittenPath(null);
    setFullSuiteRunning(true);
    try {
      const { reportPath } = await runFullDiagnosticsSuite({
        capture: micCaptureAdapter,
        playback: playbackAdapter,
        countIn: countInAdapter,
        metronomeAudio: generateMetronomeGuideAudio,
        audioContext: playbackAdapter.getAudioContext(),
        storage: diagnosticsStorage,
      });
      setFullSuiteWrittenPath(reportPath);
    } catch (e) {
      setFullSuiteError((e as Error).message);
    } finally {
      setFullSuiteRunning(false);
    }
  }

  async function writeReport(): Promise<void> {
    setError(null);
    try {
      const report = buildReport(engineEventLog.getEvents(), {
        createdAt: new Date().toISOString(),
        project: summariseProject(engine.getActiveProject()),
        audioClock: playbackAdapter.getAudioClockSession() ?? null,
        audioProcessing: captureAdapter.getAudioProcessing() ?? null,
        calibration: null,
        scenario: null,
        analysis: null,
        loopback: null,
        loopbackAnalysis: null,
      });
      setWrittenPath(await diagnosticsStorage.writeReport(report));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /**
   * Runs the default synthetic sync scenario end to end and writes its own
   * report — no microphone, no camera, no human, driven through the real
   * record/stop path with real Padding and Count-in (ADR 0004). Uses a
   * dedicated event log rather than the panel's own `engineEventLog`, so the
   * written report covers exactly this run's three passes, never events from
   * whatever the performer was doing by hand before pressing the button.
   */
  async function runScenario(): Promise<void> {
    setScenarioError(null);
    setScenarioWrittenPath(null);
    setScenarioProgress(null);
    setScenarioAnalysis(null);
    setScenarioRunning(true);
    const scenarioEvents = new EngineEventLog(
      () => playbackAdapter.getAudioContext().currentTime * 1000,
    );
    try {
      const result = await runSyntheticScenario({
        playback: playbackAdapter,
        countIn: countInAdapter,
        metronomeAudio: generateMetronomeGuideAudio,
        events: scenarioEvents,
        params: scenarioParams,
        onProgress: setScenarioProgress,
      });
      const analysis = await analyseScenarioResult(
        result,
        playbackAdapter.getAudioContext(),
      );
      setScenarioAnalysis(analysis);
      const report = buildReport(scenarioEvents.getEvents(), {
        createdAt: new Date().toISOString(),
        project: summariseProject(result.project),
        audioClock: playbackAdapter.getAudioClockSession() ?? null,
        audioProcessing: null,
        calibration: null,
        scenario: result.params,
        analysis,
        loopback: null,
        loopbackAnalysis: null,
      });
      setScenarioWrittenPath(await diagnosticsStorage.writeReport(report));
    } catch (e) {
      setScenarioError((e as Error).message);
    } finally {
      setScenarioRunning(false);
    }
  }

  /**
   * Runs Mode A end to end (ADR 0004, ADR 0006): a fresh ephemeral Project
   * with a generated Metronome Guide, recorded through the real
   * `recordTake`/`stopRecording` path against a real, audio-only microphone
   * capture adapter (#28) — the same path Mode B drives, substituting a real
   * mic for its synthetic one. Writes its own report, distinct from the
   * Synthetic Sync Scenario's report via `mode: "loopback"` (issue #21).
   * Requires speakers, not headphones — a run over headphones or with muted
   * speakers surfaces below as "no onsets detected", not a spurious number.
   */
  async function runLoopback(): Promise<void> {
    setLoopbackError(null);
    setLoopbackWrittenPath(null);
    setLoopbackAnalysis(null);
    setLoopbackRunning(true);
    const loopbackEvents = new EngineEventLog(
      () => playbackAdapter.getAudioContext().currentTime * 1000,
    );
    try {
      const result = await runLoopbackScenario({
        capture: micCaptureAdapter,
        playback: playbackAdapter,
        countIn: countInAdapter,
        metronomeAudio: generateMetronomeGuideAudio,
        events: loopbackEvents,
        audioContext: playbackAdapter.getAudioContext(),
        params: loopbackParams,
      });
      setLoopbackAnalysis(result.analysis);
      const report = buildReport(loopbackEvents.getEvents(), {
        createdAt: new Date().toISOString(),
        project: summariseProject(result.project),
        audioClock: playbackAdapter.getAudioClockSession() ?? null,
        audioProcessing: null,
        calibration: null,
        scenario: null,
        analysis: null,
        loopback: result.params,
        loopbackAnalysis: result.analysis,
      });
      setLoopbackWrittenPath(await diagnosticsStorage.writeReport(report));
    } catch (e) {
      setLoopbackError((e as Error).message);
    } finally {
      setLoopbackRunning(false);
    }
  }

  return (
    <section className="diagnostics">
      <h2>Diagnostics</h2>

      <p className="hint">
        Runs calibration, then Mode B (synthetic), then Mode A (real
        microphone), and writes one unified report. Requires speakers, not
        headphones. Takes real time.
      </p>
      <div className="panel">
        <button onClick={() => void runFullSuite()} disabled={fullSuiteRunning}>
          {fullSuiteRunning ? "Running…" : "Run Full Diagnostics"}
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      {fullSuiteWrittenPath && (
        <p className="hint">Wrote {fullSuiteWrittenPath}</p>
      )}
      {fullSuiteError && <p className="error">{fullSuiteError}</p>}

      <div className="panel">
        <button onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide Advanced" : "Advanced"}
        </button>
      </div>

      {showAdvanced && (
        <>
          <p className="hint">
            Record a Take, then write a report of what happened during that
            pass. Reports are written to the gitignored{" "}
            <code>diagnostics/</code> directory at the repository root.
          </p>

          <div className="panel">
            <button
              onClick={() => void writeReport()}
              disabled={events.length === 0}
            >
              Write Report
            </button>
            <button onClick={() => setEvents(engineEventLog.getEvents())}>
              Refresh
            </button>
            <button
              onClick={() => {
                engineEventLog.clear();
                setEvents([]);
                setWrittenPath(null);
              }}
            >
              Clear Timeline
            </button>
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
              A pass recorded this way exercises a different Offset path than
              normal use, so its numbers won't describe the case you're chasing.
            </p>
          )}
          {audioProcessing && audioProcessing.summary === "processed" && (
            <p className="hint">
              {audioProcessing.constraintsRequested
                ? `This device kept ${audioProcessing.stillActive.join(", ")} on despite being asked for unprocessed audio.`
                : `This device refused the unprocessed-audio request outright, so ${audioProcessing.stillActive.join(", ")} stayed on.`}{" "}
              Timing and level measured from these Takes describe the processing
              as much as the app.
            </p>
          )}
          {audioProcessing && audioProcessing.summary === "unknown" && (
            <p className="hint">
              This device didn't report {audioProcessing.unreported.join(", ")},
              so whether it processed the audio is unknown. Timing and level
              measured from these Takes may describe the processing as much as
              the app.
            </p>
          )}
          {writtenPath && <p className="hint">Wrote {writtenPath}</p>}
          {error && <p className="error">{error}</p>}

          <h3>Synthetic Sync Scenario</h3>
          <p className="hint">
            Runs a full scenario with no microphone, no camera, and no human:
            separate Tracks of one Take each, recorded through the real
            record/stop path with real Padding and Count-in. Writes one report
            covering all passes when it finishes. A run takes real time.
          </p>

          <div className="panel">
            <label>
              Tracks
              <input
                type="number"
                min={1}
                value={scenarioParams.trackCount}
                disabled={scenarioRunning}
                onChange={(e) =>
                  setScenarioParams((p) => ({
                    ...p,
                    trackCount: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Tempo (bpm)
              <input
                type="number"
                min={1}
                value={scenarioParams.tempoBpm}
                disabled={scenarioRunning}
                onChange={(e) =>
                  setScenarioParams((p) => ({
                    ...p,
                    tempoBpm: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Beats
              <input
                type="number"
                min={1}
                value={scenarioParams.beatCount}
                disabled={scenarioRunning}
                onChange={(e) =>
                  setScenarioParams((p) => ({
                    ...p,
                    beatCount: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Simulated latency (ms)
              <input
                type="number"
                min={0}
                value={scenarioParams.simulatedLatencyMs}
                disabled={scenarioRunning}
                onChange={(e) =>
                  setScenarioParams((p) => ({
                    ...p,
                    simulatedLatencyMs: Number(e.target.value),
                  }))
                }
              />
            </label>
            <button
              onClick={() => void runScenario()}
              disabled={scenarioRunning}
            >
              {scenarioRunning ? "Running…" : "Run Synthetic Scenario"}
            </button>
          </div>
          {scenarioParams.simulatedLatencyMs > 0 && (
            <p className="hint">
              Simulating {scenarioParams.simulatedLatencyMs}ms of capture
              latency — this run is a calibration check, not a measurement of
              the app. Set it back to 0 for a real reading.
            </p>
          )}

          {scenarioProgress && (
            <p className="value">
              {scenarioProgress.trackIndex < scenarioProgress.trackCount
                ? `Recording Track ${scenarioProgress.trackIndex + 1} of ${scenarioProgress.trackCount}…`
                : `Recorded ${scenarioProgress.trackCount} Track(s). Writing report…`}
            </p>
          )}
          {scenarioWrittenPath && (
            <p className="hint">Wrote {scenarioWrittenPath}</p>
          )}
          {scenarioError && <p className="error">{scenarioError}</p>}
          {scenarioAnalysis && <WaveformCanvas analysis={scenarioAnalysis} />}

          <h3>Acoustic Loopback</h3>
          <p className="hint">
            Plays the synthetic signal through the speakers and captures it back
            through the microphone, with no human performing — a true round-trip
            latency figure for this machine. Requires speakers: over headphones
            or with speakers muted, no onsets will be detected. Its numbers are
            environment-specific, not a portable assertion. Writes its own
            report, distinct from the Synthetic Sync Scenario's.
          </p>

          <div className="panel">
            <label>
              Tempo (bpm)
              <input
                type="number"
                min={1}
                value={loopbackParams.bpm}
                disabled={loopbackRunning}
                onChange={(e) =>
                  setLoopbackParams((p) => ({
                    ...p,
                    bpm: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Beats per bar
              <input
                type="number"
                min={1}
                value={loopbackParams.beatsPerBar}
                disabled={loopbackRunning}
                onChange={(e) =>
                  setLoopbackParams((p) => ({
                    ...p,
                    beatsPerBar: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Beats
              <input
                type="number"
                min={1}
                value={loopbackParams.beatCount}
                disabled={loopbackRunning}
                onChange={(e) =>
                  setLoopbackParams((p) => ({
                    ...p,
                    beatCount: Number(e.target.value),
                  }))
                }
              />
            </label>
            <button
              onClick={() => void runLoopback()}
              disabled={loopbackRunning}
            >
              {loopbackRunning ? "Running…" : "Run Acoustic Loopback"}
            </button>
          </div>

          {loopbackAnalysis && loopbackAnalysis.noOnsetsDetected && (
            <p className="hint">
              No onsets detected — likely headphones instead of speakers, or
              speakers muted. Check your output device and try again.
            </p>
          )}
          {loopbackAnalysis && !loopbackAnalysis.noOnsetsDetected && (
            <p className="value">
              Round-trip latency: {loopbackAnalysis.roundTripLatencyMs}ms
            </p>
          )}
          {loopbackWrittenPath && (
            <p className="hint">Wrote {loopbackWrittenPath}</p>
          )}
          {loopbackError && <p className="error">{loopbackError}</p>}
          {loopbackAnalysis && (
            <WaveformCanvas
              analysis={{
                simulatedLatencyMs: 0,
                tracks: [loopbackAnalysis.track],
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
