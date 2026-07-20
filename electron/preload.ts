// Renderer captures audio/video directly via getUserMedia/MediaRecorder, so
// no privileged APIs need to be bridged for that. Project persistence does
// need main-process filesystem access, bridged here as `window.projectStorage`.
import { contextBridge, ipcRenderer } from "electron";
import type { StoredMediaFile, StoredProjectSnapshot } from "./ipcTypes";

contextBridge.exposeInMainWorld("projectStorage", {
  saveProject: (snapshot: StoredProjectSnapshot, media: StoredMediaFile[]) =>
    ipcRenderer.invoke("project:save", snapshot, media),
  loadProject: (id: string) => ipcRenderer.invoke("project:load", id),
  listProjects: () => ipcRenderer.invoke("project:list"),
});
