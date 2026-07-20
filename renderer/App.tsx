import { useEffect, useMemo, useState } from "react";
import { RecordingEngine } from "../src/engine/RecordingEngine";
import { BrowserCaptureAdapter, BrowserPlaybackAdapter } from "../src/adapters/browserAdapters";
import { computeGridLayout } from "../src/engine/scheduling";
import type { Project, Track } from "../src/engine/types";

function selectedTakeMediaRef(track: Track): string | undefined {
  return track.takes.find((t) => t.id === track.selectedTakeId)?.mediaRef;
}

export function App() {
  const engine = useMemo(
    () => new RecordingEngine(new BrowserCaptureAdapter(), new BrowserPlaybackAdapter()),
    []
  );

  const [projectName, setProjectName] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refreshProject() {
    const activeProject = engine.getActiveProject();
    setProject(activeProject ? { ...activeProject } : null);
  }

  useEffect(() => {
    return () => {
      if (engine.getStatus() !== "idle") void engine.stop();
    };
  }, [engine]);

  function handleCreateProject() {
    if (!projectName.trim()) return;
    engine.createProject(projectName.trim());
    refreshProject();
  }

  async function handleRecordToggle() {
    setError(null);
    try {
      if (isRecording) {
        await engine.stopRecording();
        setIsRecording(false);
      } else {
        await engine.recordTake(undefined);
        setIsRecording(true);
      }
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handlePlayToggle() {
    setError(null);
    try {
      if (isPlaying) {
        await engine.stop();
        setIsPlaying(false);
      } else {
        await engine.play();
        setIsPlaying(true);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const tracks = project?.tracks ?? [];
  const hasAnyRecordedTake = tracks.some((t) => t.selectedTakeId);
  const gridLayout = useMemo(() => computeGridLayout(tracks), [tracks]);

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 720 }}>
      <h1>MultitrackIt</h1>

      {!project && (
        <section>
          <input
            placeholder="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <button onClick={handleCreateProject}>Create Project</button>
        </section>
      )}

      {project && (
        <section>
          <h2>{project.name}</h2>
          <button onClick={handleRecordToggle}>
            {isRecording ? "Stop Recording" : "Record"}
          </button>
          {hasAnyRecordedTake && (
            <button onClick={handlePlayToggle} disabled={isRecording}>
              {isPlaying ? "Stop" : "Play All Tracks"}
            </button>
          )}

          {isRecording && tracks.length > 1 && (
            <p>Monitoring {tracks.length - 1} previously recorded Track(s) in sync while you record.</p>
          )}

          <ul>
            {tracks.map((t) => (
              <li key={t.id}>
                {t.name}: {t.takes.length} take(s)
                {t.mute ? " (muted)" : ""}
                {t.solo ? " (solo)" : ""}
              </li>
            ))}
          </ul>

          {/*
            Composite video grid: one cell per visible Track, laid out via
            the pure computeGridLayout. Video is rendered muted here since
            audio for composite/monitor playback is driven separately by the
            engine's playback adapter (offset-corrected, sync'd); this grid
            is the visual counterpart of that same schedule.
          */}
          {gridLayout.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gridLayout[0].cols}, 1fr)`,
                gridTemplateRows: `repeat(${gridLayout[0].rows}, 1fr)`,
                gap: 8,
                marginTop: 16,
              }}
            >
              {gridLayout.map((cell) => {
                const cellTrack = tracks.find((t) => t.id === cell.trackId)!;
                const mediaRef = selectedTakeMediaRef(cellTrack);
                return (
                  <div
                    key={cell.trackId}
                    style={{
                      gridRow: cell.row + 1,
                      gridColumn: cell.col + 1,
                      background: "#000",
                      aspectRatio: "16 / 9",
                    }}
                  >
                    {mediaRef && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video
                        src={mediaRef}
                        muted
                        playsInline
                        autoPlay={isPlaying}
                        style={{ width: "100%", height: "100%" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
