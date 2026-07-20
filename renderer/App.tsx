import { useEffect } from "react";
import { engine } from "./store/engine";
import { useProjectStore } from "./store/useProjectStore";
import { ProjectPicker } from "./components/ProjectPicker";
import { Toolbar } from "./components/Toolbar";
import { GuideSection } from "./components/GuideSection";
import { TrackList } from "./components/TrackList";
import { VideoGrid } from "./components/VideoGrid";

export function App() {
  const project = useProjectStore((s) => s.project);
  const error = useProjectStore((s) => s.error);
  const refreshSavedProjects = useProjectStore((s) => s.refreshSavedProjects);

  useEffect(() => {
    return () => {
      if (engine.getStatus() !== "idle") void engine.stop();
    };
  }, []);

  useEffect(() => {
    void refreshSavedProjects();
  }, [refreshSavedProjects]);

  const tracks = project?.tracks ?? [];
  const hasAnyRecordedTake = tracks.some((t) => t.selectedTakeId);

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 720 }}>
      <h1>MultitrackIt</h1>

      {!project && <ProjectPicker />}

      {project && (
        <section>
          <Toolbar projectName={project.name} hasAnyRecordedTake={hasAnyRecordedTake} />
          <GuideSection />
          <TrackList tracks={tracks} />
          <VideoGrid tracks={tracks} />
        </section>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
