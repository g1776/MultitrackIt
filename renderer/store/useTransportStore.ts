import { create } from "zustand";
import { engine } from "./engine";
import { useProjectStore } from "./useProjectStore";

interface TransportState {
  isRecording: boolean;
  isPlaying: boolean;
  recordingTrackId: string | undefined;
  livePreviewTrackId: string | undefined;

  recordToggle: (trackId?: string) => Promise<void>;
  playToggle: () => Promise<void>;
  reset: () => void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  isRecording: false,
  isPlaying: false,
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

  reset: () => set({ isRecording: false, isPlaying: false, recordingTrackId: undefined, livePreviewTrackId: undefined }),
}));
