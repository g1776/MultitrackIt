// Renderer captures audio/video directly via getUserMedia/MediaRecorder, so
// no privileged APIs need to be bridged for that. Project persistence does
// need main-process filesystem access, bridged here as `window.projectStorage`.
import { contextBridge, ipcRenderer } from "electron";
import type { StoredDiagnosticsReport, StoredMediaFile, StoredProjectSnapshot } from "./ipcTypes";

contextBridge.exposeInMainWorld("projectStorage", {
  saveProject: (snapshot: StoredProjectSnapshot, media: StoredMediaFile[]) =>
    ipcRenderer.invoke("project:save", snapshot, media),
  loadProject: (id: string) => ipcRenderer.invoke("project:load", id),
  listProjects: () => ipcRenderer.invoke("project:list"),
});

// Diagnostics reports get their own bridge rather than joining the one
// above: Project persistence is about snapshots and media, and diagnostics
// is an instrument measuring the app, not part of what the app stores.
contextBridge.exposeInMainWorld("diagnosticsStorage", {
  writeReport: (fileName: string, report: StoredDiagnosticsReport) =>
    ipcRenderer.invoke("diagnostics:write", fileName, report),
});
