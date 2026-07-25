import { useEffect } from "react";
import { engine } from "./store/engine";
import { useProjectStore } from "./store/useProjectStore";
import { ProjectPicker } from "./components/ProjectPicker";
import { Toolbar } from "./components/Toolbar";
import { GuideSection } from "./components/GuideSection";
import { TempoControls } from "./components/controls/TempoControls";
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

  // Two panes, both sized to the viewport: controls on the left (the only
  // thing that ever scrolls, and only when there are more Tracks than fit)
  // and the video grid on the right, sized to fit its pane so the grid is
  // always wholly visible. Keeping the grid on screen alongside the
  // transport is what makes sync problems observable while recording rather
  // than only after scrolling to find the grid.
  return (
    <main className="app">
      <aside className="app__controls">
        <h1>MultitrackIt</h1>

        {!project && <ProjectPicker />}

        {project && (
          <>
            <Toolbar projectName={project.name} hasAnyRecordedTake={hasAnyRecordedTake} />
            <TempoControls />
            <GuideSection />
            <TrackList tracks={tracks} />
          </>
        )}

        {error && <p className="error">{error}</p>}
      </aside>

      <div className="app__stage">{project && <VideoGrid tracks={tracks} />}</div>
    </main>
  );
}
