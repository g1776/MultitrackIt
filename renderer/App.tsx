import { useEffect, useMemo, useRef, useState } from "react";
import { RecordingEngine } from "../src/engine/RecordingEngine";
import { BrowserCaptureAdapter, BrowserPlaybackAdapter } from "../src/adapters/browserAdapters";
import { computeGridLayout } from "../src/engine/scheduling";
import type { Project, Track } from "../src/engine/types";
import { generateMetronomeGuideAudio } from "../src/adapters/metronomeAudio";
import { ElectronProjectStorageAdapter } from "../src/adapters/electronStorageAdapter";
import { createBlobUrlMediaRef, fetchBlobUrlMedia } from "../src/adapters/mediaCodec";
import { prepareSnapshotForSave, rehydrateSnapshot } from "../src/persistence/projectPersistence";
import type { ProjectSummary, ProjectStorageAdapter } from "../src/persistence/types";

// Fixed rather than user-configurable: long enough to cover most songs, and
// simpler than asking the user to guess a duration before they've recorded
// anything to measure against.
const METRONOME_GUIDE_DURATION_MS = 5 * 60 * 1000;

function selectedTakeMediaRef(track: Track): string | undefined {
  return track.takes.find((t) => t.id === track.selectedTakeId)?.mediaRef;
}

function TrackNameInput({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);

  useEffect(() => setDraft(name), [name]);

  function commit() {
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
    else setDraft(name);
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label={`Rename ${name}`}
      style={{ width: 120 }}
    />
  );
}

function MetronomeGuideControls({
  bpm,
  beatsPerBar,
  onBpmChange,
  onBeatsPerBarChange,
  onGenerate,
}: {
  bpm: number;
  beatsPerBar: number;
  onBpmChange: (bpm: number) => void;
  onBeatsPerBarChange: (beatsPerBar: number) => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <label>
        BPM:{" "}
        <input
          type="number"
          min={20}
          max={300}
          value={bpm}
          onChange={(e) => onBpmChange(Number(e.target.value))}
          aria-label="Metronome BPM"
          style={{ width: 60 }}
        />
      </label>{" "}
      <label>
        Beats per bar:{" "}
        <select
          value={beatsPerBar}
          onChange={(e) => onBeatsPerBarChange(Number(e.target.value))}
          aria-label="Metronome beats per bar"
        >
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>{" "}
      <button onClick={onGenerate}>Generate Metronome Guide</button>
    </>
  );
}

function MonitorMixVolumeSlider({
  label,
  volume,
  onChange,
}: {
  label: string;
  volume: number;
  onChange: (volume: number) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
      Monitor Mix ({label}):
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Monitor Mix volume for ${label}`}
      />
    </label>
  );
}

function TakeOffsetInput({
  offsetMs,
  onChange,
}: {
  offsetMs: number;
  onChange: (offsetMs: number) => void;
}) {
  const [draft, setDraft] = useState(String(offsetMs));

  useEffect(() => setDraft(String(offsetMs)), [offsetMs]);

  function commit() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== offsetMs) onChange(parsed);
    else setDraft(String(offsetMs));
  }

  return (
    <label style={{ marginLeft: 8 }}>
      Offset (ms):{" "}
      <input
        type="number"
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Take Offset in milliseconds"
        style={{ width: 80 }}
      />
    </label>
  );
}

export function App() {
  const engine = useMemo(
    () => new RecordingEngine(new BrowserCaptureAdapter(), new BrowserPlaybackAdapter()),
    []
  );
  const storage: ProjectStorageAdapter = useMemo(() => new ElectronProjectStorageAdapter(), []);

  const [projectName, setProjectName] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingTrackId, setRecordingTrackId] = useState<string | undefined>(undefined);
  const [monitorMixLevels, setMonitorMixLevels] = useState<Record<string, number>>({});
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [metronomeBeatsPerBar, setMetronomeBeatsPerBar] = useState(4);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  function refreshProject() {
    const activeProject = engine.getActiveProject();
    setProject(activeProject ? { ...activeProject } : null);
  }

  useEffect(() => {
    return () => {
      if (engine.getStatus() !== "idle") void engine.stop();
    };
  }, [engine]);

  useEffect(() => {
    void refreshSavedProjects();
  }, []);

  async function refreshSavedProjects() {
    try {
      setSavedProjects(await storage.listProjects());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleCreateProject() {
    if (!projectName.trim()) return;
    engine.createProject(projectName.trim());
    setMonitorMixLevels({});
    refreshProject();
  }

  async function handleSaveProject() {
    setError(null);
    setIsSaving(true);
    try {
      const snapshot = engine.exportSnapshot();
      const prepared = await prepareSnapshotForSave(snapshot, fetchBlobUrlMedia);
      await storage.saveProject(prepared.snapshot, prepared.media);
      await refreshSavedProjects();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadProject(id: string) {
    setError(null);
    try {
      if (engine.getStatus() !== "idle") await engine.stop();
      const saved = await storage.loadProject(id);
      if (!saved) throw new Error(`Project ${id} not found`);
      const snapshot = rehydrateSnapshot(saved, createBlobUrlMediaRef);
      engine.loadSnapshot(snapshot);
      setMonitorMixLevels(
        Object.fromEntries(snapshot.monitorMix.map((m) => [m.targetId, m.level]))
      );
      setIsRecording(false);
      setIsPlaying(false);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRecordToggle(trackId?: string) {
    setError(null);
    try {
      if (isRecording) {
        await engine.stopRecording();
        setIsRecording(false);
        setRecordingTrackId(undefined);
      } else {
        await engine.recordTake(trackId);
        setIsRecording(true);
        setRecordingTrackId(trackId);
      }
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleRenameTrack(trackId: string, name: string) {
    if (!name.trim()) return;
    setError(null);
    try {
      engine.renameTrack(trackId, name.trim());
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleSelectTake(trackId: string, takeId: string) {
    setError(null);
    try {
      engine.selectTake(trackId, takeId);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleImportGuide(file: File) {
    setError(null);
    try {
      engine.importGuide(URL.createObjectURL(file));
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleGenerateMetronomeGuide() {
    setError(null);
    try {
      const mediaRef = generateMetronomeGuideAudio({
        bpm: metronomeBpm,
        beatsPerBar: metronomeBeatsPerBar,
        durationMs: METRONOME_GUIDE_DURATION_MS,
      });
      engine.importGuide(mediaRef);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleGuideIncludeInMonitorMixChange(include: boolean) {
    setError(null);
    try {
      engine.setGuideIncludeInMonitorMix(include);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleGuideIncludeInMixdownChange(include: boolean) {
    setError(null);
    try {
      engine.setGuideIncludeInMixdown(include);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleMonitorMixChange(targetId: string, level: number) {
    engine.setMonitorMixLevel(targetId, level);
    setMonitorMixLevels((prev) => ({ ...prev, [targetId]: level }));
  }

  function handleSetTrackMuteSolo(trackId: string, changes: { mute?: boolean; solo?: boolean }) {
    setError(null);
    try {
      engine.setTrackMuteSolo(trackId, changes);
      refreshProject();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSetTakeOffset(takeId: string, offsetMs: number) {
    setError(null);
    try {
      await engine.setTakeOffset(takeId, offsetMs);
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

          {savedProjects.length > 0 && (
            <ul>
              {savedProjects.map((p) => (
                <li key={p.id}>
                  {p.name}{" "}
                  <button onClick={() => handleLoadProject(p.id)}>Open</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {project && (
        <section>
          <h2>{project.name}</h2>
          <button onClick={handleSaveProject} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Project"}
          </button>
          <button
            onClick={() => handleRecordToggle(undefined)}
            disabled={isRecording && recordingTrackId !== undefined}
          >
            {isRecording && recordingTrackId === undefined ? "Stop Recording" : "Record New Track"}
          </button>
          {hasAnyRecordedTake && (
            <button onClick={handlePlayToggle} disabled={isRecording}>
              {isPlaying ? "Stop" : "Play All Tracks"}
            </button>
          )}

          {isRecording && tracks.length > 1 && (
            <p>Monitoring {tracks.length - 1} previously recorded Track(s) in sync while you record.</p>
          )}

          <section style={{ marginTop: 8 }}>
            <label>
              Guide (backing track / click):{" "}
              <input
                type="file"
                accept="audio/*"
                aria-label="Import Guide"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportGuide(file);
                  e.target.value = "";
                }}
              />
            </label>
            {" or "}
            <MetronomeGuideControls
              bpm={metronomeBpm}
              beatsPerBar={metronomeBeatsPerBar}
              onBpmChange={setMetronomeBpm}
              onBeatsPerBarChange={setMetronomeBeatsPerBar}
              onGenerate={handleGenerateMetronomeGuide}
            />
            {project.guide && (
              <>
                {" (Guide imported) "}
                <label>
                  <input
                    type="checkbox"
                    checked={project.guide.includeInMonitorMix}
                    onChange={(e) => handleGuideIncludeInMonitorMixChange(e.target.checked)}
                    aria-label="Include Guide in Monitor Mix"
                  />{" "}
                  Include in Monitor Mix
                </label>{" "}
                <label>
                  <input
                    type="checkbox"
                    checked={project.guide.includeInMixdown}
                    onChange={(e) => handleGuideIncludeInMixdownChange(e.target.checked)}
                    aria-label="Include Guide in Mixdown"
                  />{" "}
                  Include in Mixdown
                </label>
                <MonitorMixVolumeSlider
                  label="Guide"
                  volume={monitorMixLevels["guide"] ?? 1}
                  onChange={(level) => handleMonitorMixChange("guide", level)}
                />
              </>
            )}
          </section>

          <ul>
            {tracks.map((t) => (
              <li key={t.id}>
                <TrackNameInput
                  name={t.name}
                  onRename={(name) => handleRenameTrack(t.id, name)}
                />
                : {t.takes.length} take(s)
                {t.mute ? " (muted)" : ""}
                {t.solo ? " (solo)" : ""}
                <button
                  onClick={() => handleSetTrackMuteSolo(t.id, { mute: !t.mute })}
                  aria-pressed={t.mute}
                  aria-label={`Mute ${t.name}`}
                >
                  {t.mute ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={() => handleSetTrackMuteSolo(t.id, { solo: !t.solo })}
                  aria-pressed={t.solo}
                  aria-label={`Solo ${t.name}`}
                >
                  {t.solo ? "Unsolo" : "Solo"}
                </button>
                {t.takes.length > 0 && (
                  <select
                    value={t.selectedTakeId ?? ""}
                    onChange={(e) => handleSelectTake(t.id, e.target.value)}
                    aria-label={`Select take for ${t.name}`}
                  >
                    {t.takes.map((take, i) => (
                      <option key={take.id} value={take.id}>
                        Take {i + 1}
                      </option>
                    ))}
                  </select>
                )}
                {t.selectedTakeId && (
                  <TakeOffsetInput
                    offsetMs={t.takes.find((take) => take.id === t.selectedTakeId)!.offsetMs}
                    onChange={(offsetMs) => handleSetTakeOffset(t.selectedTakeId!, offsetMs)}
                  />
                )}
                <button
                  onClick={() => handleRecordToggle(t.id)}
                  disabled={isRecording && recordingTrackId !== t.id}
                >
                  {isRecording && recordingTrackId === t.id ? "Stop Recording" : "Record Take"}
                </button>
                <MonitorMixVolumeSlider
                  label={t.name}
                  volume={monitorMixLevels[t.id] ?? 1}
                  onChange={(level) => handleMonitorMixChange(t.id, level)}
                />
              </li>
            ))}
          </ul>

          {/*
            Composite video grid: one cell per visible Track, laid out via
            the pure computeGridLayout. Video is rendered muted here since
            audio for composite/monitor playback is driven separately by the
            engine's playback adapter; each cell's own start is scheduled off
            the same startAtMs (see the isPlaying effect above) so the grid
            stays offset-corrected and in sync with that audio.
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
            </div>
          )}
        </section>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
