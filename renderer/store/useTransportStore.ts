import { create } from "zustand";
import type { MetronomeClick } from "../../src/engine/metronome";
import { engine } from "./engine";
import { useProjectStore } from "./useProjectStore";

/**
 * Which phase of the recording lead-in is in progress, or null when none is:
 * the silent Count-in Padding ("getting-ready") and the audible Count-in are
 * distinct states to the performer, so the UI can say which one it is in.
 */
export type LeadInPhase = "getting-ready" | "counting-in";

interface TransportState {
  isRecording: boolean;
  isPlaying: boolean;
  leadInPhase: LeadInPhase | null;
  /**
   * The beats of the Count-in now sounding, empty outside one. Captured from
   * the engine's own plan as the Count-in begins, so the UI displays the same
   * beats the engine sounds rather than a duration recomputed from tempo.
   */
  countInClicks: MetronomeClick[];
  recordingTrackId: string | undefined;
  livePreviewTrackId: string | undefined;

  recordToggle: (trackId?: string) => Promise<void>;
  playToggle: () => Promise<void>;
  reset: () => void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  isRecording: false,
  isPlaying: false,
  leadInPhase: null,
  countInClicks: [],
  recordingTrackId: undefined,
  livePreviewTrackId: undefined,

  recordToggle: async (trackId) => {
    const projectStore = useProjectStore.getState();
    useProjectStore.setState({ error: null });
    try {
      if (get().isRecording) {
        await engine.stopRecording();
        set({ isRecording: false, recordingTrackId: undefined, livePreviewTrackId: undefined });
      } else {
        await engine.recordTake(trackId);
        // trackId is undefined for "record onto a new Track" — resolve to
        // the Track the engine just created so the live preview knows which
        // grid cell it belongs to.
        const livePreviewTrackId = trackId ?? engine.getActiveProject()!.tracks.at(-1)!.id;
        set({ isRecording: true, recordingTrackId: trackId, livePreviewTrackId });
      }
      projectStore.refreshProject();
    } catch (e) {
      useProjectStore.setState({ error: (e as Error).message });
    }
  },

  playToggle: async () => {
    useProjectStore.setState({ error: null });
    try {
      if (get().isPlaying) {
        await engine.stop();
        set({ isPlaying: false });
      } else {
        await engine.play();
        set({ isPlaying: true });
      }
    } catch (e) {
      useProjectStore.setState({ error: (e as Error).message });
    }
  },

  reset: () =>
    set({
      isRecording: false,
      isPlaying: false,
      leadInPhase: null,
      countInClicks: [],
      recordingTrackId: undefined,
      livePreviewTrackId: undefined,
    }),
}));

// The lead-in's two phases both happen inside a single awaited recordTake
// call, so they're mirrored from the engine's own status rather than guessed
// at from timers here — the engine owns when getting ready ends and counting
// in begins, and the UI only reports it.
engine.onStatusChange((status) => {
  const leadInPhase =
    status === "getting-ready" || status === "counting-in" ? status : null;
  if (useTransportStore.getState().leadInPhase === leadInPhase) return;
  useTransportStore.setState({
    leadInPhase,
    countInClicks: status === "counting-in" ? engine.getCountInPlan().clicks : [],
  });
});
