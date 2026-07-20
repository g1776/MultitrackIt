import type { MediaFile, ProjectSnapshot, ProjectStorageAdapter, ProjectSummary } from "../persistence/types";

/** The IPC surface `electron/preload.ts` exposes on `window.projectStorage`. */
export interface ProjectStorageBridge {
  saveProject(snapshot: ProjectSnapshot, media: MediaFile[]): Promise<void>;
  loadProject(id: string): Promise<{ snapshot: ProjectSnapshot; media: MediaFile[] } | null>;
  listProjects(): Promise<ProjectSummary[]>;
}

declare global {
  interface Window {
    projectStorage: ProjectStorageBridge;
  }
}

/**
 * Real storage adapter, backed by Electron main-process filesystem access
 * via the `window.projectStorage` IPC bridge (see `electron/preload.ts` and
 * `electron/main.ts`). This is the Electron-backed implementation of the
 * `ProjectStorageAdapter` seam; the app never touches `fs`/IPC directly.
 */
export class ElectronProjectStorageAdapter implements ProjectStorageAdapter {
  saveProject(snapshot: ProjectSnapshot, media: MediaFile[]): Promise<void> {
    return window.projectStorage.saveProject(snapshot, media);
  }

  loadProject(id: string): Promise<{ snapshot: ProjectSnapshot; media: MediaFile[] } | null> {
    return window.projectStorage.loadProject(id);
  }

  listProjects(): Promise<ProjectSummary[]> {
    return window.projectStorage.listProjects();
  }
}
