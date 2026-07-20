import { create } from "zustand";
import type { Project } from "../../src/engine/types";
import type { ProjectSummary } from "../../src/persistence/types";
import { createBlobUrlMediaRef, fetchBlobUrlMedia } from "../../src/adapters/mediaCodec";
import { prepareSnapshotForSave, rehydrateSnapshot } from "../../src/persistence/projectPersistence";
import { engine, storage } from "./engine";
import { useTransportStore } from "./useTransportStore";

interface ProjectState {
  project: Project | null;
  savedProjects: ProjectSummary[];
  monitorMixLevels: Record<string, number>;
  isSaving: boolean;
  error: string | null;

  refreshProject: () => void;
  refreshSavedProjects: () => Promise<void>;
  createProject: (name: string) => void;
  saveProject: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  renameTrack: (trackId: string, name: string) => void;
  selectTake: (trackId: string, takeId: string) => void;
  importGuide: (mediaRef: string) => void;
  setGuideIncludeInMonitorMix: (include: boolean) => void;
  setGuideIncludeInMixdown: (include: boolean) => void;
  setMonitorMixLevel: (targetId: string, level: number) => void;
  setTrackMuteSolo: (trackId: string, changes: { mute?: boolean; solo?: boolean }) => void;
  setTakeOffset: (takeId: string, offsetMs: number) => Promise<void>;
}

// The engine mutates its Project (and Track array) in place, so a shallow
// `{ ...project }` copy still carries over the *same* `tracks` array
// reference across refreshes. Anything keyed off that reference for
// reactivity (e.g. the video grid's `useMemo(..., [tracks])`) would then
// never recompute after the first render. Cloning `tracks` (and each
// Track's own `takes`) gives every refresh a fresh reference to key off.
function snapshotProject(project: Project | null): Project | null {
  if (!project) return null;
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, takes: [...t.takes] })) };
}

// Wraps every RecordingEngine mutation with the same refresh-project /
// surface-error pattern the renderer previously repeated by hand in App.tsx.
function guarded(set: (partial: Partial<ProjectState>) => void, fn: () => void): void {
  set({ error: null });
  try {
    fn();
  } catch (e) {
    set({ error: (e as Error).message });
    return;
  }
  set({ project: snapshotProject(engine.getActiveProject()) });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  savedProjects: [],
  monitorMixLevels: {},
  isSaving: false,
  error: null,

  refreshProject: () => {
    set({ project: snapshotProject(engine.getActiveProject()) });
  },

  refreshSavedProjects: async () => {
    try {
      set({ savedProjects: await storage.listProjects() });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  createProject: (name) => {
    if (!name.trim()) return;
    engine.createProject(name.trim());
    set({ monitorMixLevels: {} });
    get().refreshProject();
  },

  saveProject: async () => {
    set({ error: null, isSaving: true });
    try {
      const snapshot = engine.exportSnapshot();
      const prepared = await prepareSnapshotForSave(snapshot, fetchBlobUrlMedia);
      await storage.saveProject(prepared.snapshot, prepared.media);
      await get().refreshSavedProjects();
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isSaving: false });
    }
  },

  loadProject: async (id) => {
    set({ error: null });
    try {
      if (engine.getStatus() !== "idle") await engine.stop();
      const saved = await storage.loadProject(id);
      if (!saved) throw new Error(`Project ${id} not found`);
      const snapshot = rehydrateSnapshot(saved, createBlobUrlMediaRef);
      engine.loadSnapshot(snapshot);
      set({
        monitorMixLevels: Object.fromEntries(snapshot.monitorMix.map((m) => [m.targetId, m.level])),
      });
      useTransportStore.getState().reset();
      get().refreshProject();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  renameTrack: (trackId, name) => {
    if (!name.trim()) return;
    guarded(set, () => engine.renameTrack(trackId, name.trim()));
  },

  selectTake: (trackId, takeId) => guarded(set, () => engine.selectTake(trackId, takeId)),

  importGuide: (mediaRef) => guarded(set, () => engine.importGuide(mediaRef)),

  setGuideIncludeInMonitorMix: (include) =>
    guarded(set, () => engine.setGuideIncludeInMonitorMix(include)),

  setGuideIncludeInMixdown: (include) =>
    guarded(set, () => engine.setGuideIncludeInMixdown(include)),

  setMonitorMixLevel: (targetId, level) => {
    engine.setMonitorMixLevel(targetId, level);
    set((state) => ({ monitorMixLevels: { ...state.monitorMixLevels, [targetId]: level } }));
  },

  setTrackMuteSolo: (trackId, changes) =>
    guarded(set, () => engine.setTrackMuteSolo(trackId, changes)),

  setTakeOffset: async (takeId, offsetMs) => {
    set({ error: null });
    try {
      await engine.setTakeOffset(takeId, offsetMs);
      get().refreshProject();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
