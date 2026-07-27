import { RecordingEngine } from "../../src/engine/RecordingEngine";
import { BrowserCaptureAdapter, BrowserPlaybackAdapter } from "../../src/adapters/browserAdapters";
import { BrowserCountInAdapter } from "../../src/adapters/countInAudio";
import { generateMetronomeGuideAudio } from "../../src/adapters/metronomeAudio";
import { ElectronProjectStorageAdapter } from "../../src/adapters/electronStorageAdapter";
import { ElectronDiagnosticsStorageAdapter } from "../../src/adapters/electronDiagnosticsStorageAdapter";
import { EngineEventLog } from "../../src/diagnostics/eventLog";
import type { DiagnosticsStorageAdapter } from "../../src/diagnostics/types";
import type { ProjectStorageAdapter } from "../../src/persistence/types";

// Module-level singletons rather than per-render useMemo: the renderer only
// ever has one RecordingEngine/CaptureAdapter/storage for its lifetime, and
// zustand stores (which import these directly) need a stable reference that
// exists before any component mounts.
export const captureAdapter = new BrowserCaptureAdapter();
export const playbackAdapter = new BrowserPlaybackAdapter();
export const countInAdapter = new BrowserCountInAdapter(() => playbackAdapter.getAudioContext());

/**
 * The diagnostics event timeline, stamped from the same AudioContext clock
 * that drives playback scheduling — so a report's times are directly
 * comparable to the scheduling decisions in it, rather than being wall-clock
 * readings of a different clock (ADR 0004). Attached unconditionally: it only
 * accumulates events, and nothing reads it outside the Diagnostics panel.
 */
export const engineEventLog = new EngineEventLog(
  () => playbackAdapter.getAudioContext().currentTime * 1000
);
export const engine = new RecordingEngine(captureAdapter, playbackAdapter, {
  countIn: countInAdapter,
  events: engineEventLog,
  metronomeAudio: generateMetronomeGuideAudio,
});
export const storage: ProjectStorageAdapter = new ElectronProjectStorageAdapter();
export const diagnosticsStorage: DiagnosticsStorageAdapter =
  new ElectronDiagnosticsStorageAdapter();
