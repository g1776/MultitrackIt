/**
 * The wire shape for Project persistence IPC. Deliberately duplicated from
 * (rather than importing) `src/persistence/types.ts`'s `ProjectSnapshot`:
 * the main process only needs to store/retrieve opaque JSON plus media
 * bytes, never interpret Track/Take/Guide structure, so it stays decoupled
 * from the engine's domain types (and out of the renderer's `rootDir`).
 */
export interface StoredProjectSnapshot {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface StoredMediaFile {
  ref: string;
  bytes: ArrayBuffer;
  mimeType: string;
}

/**
 * The wire shape for a diagnostics report. Like `StoredProjectSnapshot`, the
 * main process only writes opaque JSON — the event timeline's structure is
 * the renderer's business.
 */
export interface StoredDiagnosticsReport {
  createdAt: string;
  [key: string]: unknown;
}

export interface StoredProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}
