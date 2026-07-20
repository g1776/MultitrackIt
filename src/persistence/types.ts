import type { Guide, MonitorMixLevel, Track } from "../engine/types";

/**
 * A serializable snapshot of a Project's full state — Tracks, Takes, Guide,
 * and Monitor Mix levels — sufficient to reconstruct it in a fresh
 * `RecordingEngine` via `loadSnapshot`. Layout is deliberately not stored
 * here: it's deterministically derived from Tracks (`computeGridLayout`), so
 * persisting Tracks is sufficient to reproduce it on reload.
 */
export interface ProjectSnapshot {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
  guide: Guide | null;
  monitorMix: MonitorMixLevel[];
}

/** One media file (a Take's or Guide's recorded/imported audio+video) to persist alongside a snapshot. */
export interface MediaFile {
  /** The stable, file-safe name used as this media's `mediaRef` within a saved snapshot. */
  ref: string;
  bytes: ArrayBuffer;
  mimeType: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

/**
 * Seam between Project persistence and actual disk storage. The app depends
 * only on this interface, never on Electron/filesystem APIs directly, so it
 * can be exercised in tests with a fake.
 */
export interface ProjectStorageAdapter {
  saveProject(snapshot: ProjectSnapshot, media: MediaFile[]): Promise<void>;
  loadProject(id: string): Promise<{ snapshot: ProjectSnapshot; media: MediaFile[] } | null>;
  listProjects(): Promise<ProjectSummary[]>;
}
