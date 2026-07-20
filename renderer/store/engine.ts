import { RecordingEngine } from "../../src/engine/RecordingEngine";
import { BrowserCaptureAdapter, BrowserPlaybackAdapter } from "../../src/adapters/browserAdapters";
import { ElectronProjectStorageAdapter } from "../../src/adapters/electronStorageAdapter";
import type { ProjectStorageAdapter } from "../../src/persistence/types";

// Module-level singletons rather than per-render useMemo: the renderer only
// ever has one RecordingEngine/CaptureAdapter/storage for its lifetime, and
// zustand stores (which import these directly) need a stable reference that
// exists before any component mounts.
export const captureAdapter = new BrowserCaptureAdapter();
export const engine = new RecordingEngine(captureAdapter, new BrowserPlaybackAdapter());
export const storage: ProjectStorageAdapter = new ElectronProjectStorageAdapter();
