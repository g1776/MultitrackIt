import { create } from "zustand";
import { engine } from "./engine";
import { useProjectStore } from "./useProjectStore";

interface TransportState {
  isRecording: boolean;
  isPlaying: boolean;
  /** True from the moment recordToggle triggers recording until the Count-in elapses and capture actually starts. */
  isCountingIn: boolean;
  recordingTrackId: string | undefined;
  livePreviewTrackId: string | undefined;

  recordToggle: (trackId?: string) => Promise<void>;
  playToggle: () => Promise<void>;
  reset: () => void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  isRecording: false,
  isPlaying: false,
  isCountingIn: false,
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
        set({ isCountingIn: true });
        await engine.recordTake(trackId);
        // trackId is undefined for "record onto a new Track" — resolve to
        // the Track the engine just created so the live preview knows which
        // grid cell it belongs to.
        const livePreviewTrackId = trackId ?? engine.getActiveProject()!.tracks.at(-1)!.id;
        set({ isRecording: true, isCountingIn: false, recordingTrackId: trackId, livePreviewTrackId });
      }
      projectStore.refreshProject();
    } catch (e) {
      set({ isCountingIn: false });
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
      isCountingIn: false,
      recordingTrackId: undefined,
      livePreviewTrackId: undefined,
    }),
}));
