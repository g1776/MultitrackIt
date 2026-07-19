import { useEffect, useMemo, useState } from "react";
import { RecordingEngine } from "../src/engine/RecordingEngine";
import { BrowserCaptureAdapter, BrowserPlaybackAdapter } from "../src/adapters/browserAdapters";
import type { Project } from "../src/engine/types";

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

  const track = project?.tracks[0];

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 480 }}>
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
          {track?.selectedTakeId && (
            <button onClick={handlePlayToggle} disabled={isRecording}>
              {isPlaying ? "Stop" : "Play"}
            </button>
          )}
          {track && (
            <p>
              {track.name}: {track.takes.length} take(s)
            </p>
          )}
        </section>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
