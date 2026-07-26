import { useProjectStore } from "../store/useProjectStore";
import { useTransportStore } from "../store/useTransportStore";
import { CountIn } from "./CountIn";

export function Toolbar({ projectName, hasAnyRecordedTake }: { projectName: string; hasAnyRecordedTake: boolean }) {
  const saveProject = useProjectStore((s) => s.saveProject);
  const isSaving = useProjectStore((s) => s.isSaving);
  const trackCount = useProjectStore((s) => s.project?.tracks.length ?? 0);

  const isRecording = useTransportStore((s) => s.isRecording);
  const leadInPhase = useTransportStore((s) => s.leadInPhase);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const recordingTrackId = useTransportStore((s) => s.recordingTrackId);
  const recordToggle = useTransportStore((s) => s.recordToggle);
  const playToggle = useTransportStore((s) => s.playToggle);

  return (
    <>
      <h2>{projectName}</h2>
      <div className="panel">
        <button onClick={() => void saveProject()} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save Project"}
        </button>
        <button
          onClick={() => void recordToggle(undefined)}
          disabled={leadInPhase !== null || (isRecording && recordingTrackId !== undefined)}
        >
          {isRecording && recordingTrackId === undefined ? "Stop Recording" : "Record New Track"}
        </button>
        {hasAnyRecordedTake && (
          <button onClick={() => void playToggle()} disabled={isRecording || leadInPhase !== null}>
            {isPlaying ? "Stop" : "Play All Tracks"}
          </button>
        )}
      </div>

      <CountIn />

      {isRecording && trackCount > 1 && (
        <p className="hint">Monitoring {trackCount - 1} previously recorded Track(s) in sync while you record.</p>
      )}
    </>
  );
}
