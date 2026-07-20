import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import type { StoredMediaFile, StoredProjectSnapshot, StoredProjectSummary } from "./ipcTypes";

const isDev = !app.isPackaged;

function projectsDir(): string {
  return path.join(app.getPath("userData"), "projects");
}

function projectDir(id: string): string {
  return path.join(projectsDir(), id);
}

async function saveProject(snapshot: StoredProjectSnapshot, media: StoredMediaFile[]): Promise<void> {
  const dir = projectDir(snapshot.id);
  const mediaDir = path.join(dir, "media");
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(snapshot, null, 2), "utf-8");
  // Recorded alongside the files themselves so a file's original MIME type
  // survives the round trip exactly, rather than being re-guessed from its
  // extension on load (lossy for anything the guess table doesn't cover).
  const manifest: Record<string, string> = Object.fromEntries(
    media.map((file) => [file.ref, file.mimeType])
  );
  await fs.writeFile(path.join(mediaDir, "manifest.json"), JSON.stringify(manifest), "utf-8");
  await Promise.all(
    media.map((file) => fs.writeFile(path.join(mediaDir, file.ref), Buffer.from(file.bytes)))
  );
}

async function loadProject(
  id: string
): Promise<{ snapshot: StoredProjectSnapshot; media: StoredMediaFile[] } | null> {
  const dir = projectDir(id);
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "project.json"), "utf-8");
  } catch {
    return null;
  }
  const snapshot: StoredProjectSnapshot = JSON.parse(raw);

  const mediaDir = path.join(dir, "media");
  const manifest: Record<string, string> = JSON.parse(
    await fs.readFile(path.join(mediaDir, "manifest.json"), "utf-8")
  );
  const fileNames = (await fs.readdir(mediaDir)).filter((name) => name !== "manifest.json");
  const media: StoredMediaFile[] = await Promise.all(
    fileNames.map(async (ref) => {
      const buffer = await fs.readFile(path.join(mediaDir, ref));
      return {
        ref,
        bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        mimeType: manifest[ref] ?? "application/octet-stream",
      };
    })
  );
  return { snapshot, media };
}

async function listProjects(): Promise<StoredProjectSummary[]> {
  let ids: string[];
  try {
    ids = await fs.readdir(projectsDir());
  } catch {
    return [];
  }
  const summaries = await Promise.all(
    ids.map(async (id) => {
      try {
        const raw = await fs.readFile(path.join(projectDir(id), "project.json"), "utf-8");
        const stat = await fs.stat(path.join(projectDir(id), "project.json"));
        const snapshot: StoredProjectSnapshot = JSON.parse(raw);
        return { id: snapshot.id, name: snapshot.name, updatedAt: stat.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  return summaries.filter((s): s is StoredProjectSummary => s !== null);
}

ipcMain.handle("project:save", (_event, snapshot: StoredProjectSnapshot, media: StoredMediaFile[]) =>
  saveProject(snapshot, media)
);
ipcMain.handle("project:load", (_event, id: string) => loadProject(id));
ipcMain.handle("project:list", () => listProjects());

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
