import { create } from "zustand";
import type { MetronomeClick } from "../../src/engine/metronome";
import { engine } from "./engine";
import { useProjectStore } from "./useProjectStore";

/**
 * Which phase of the recording lead-in is in progress, or null when none is:
 * "arming" (acquiring the capture device and waiting for it to be ready,
 * ADR 0005), the silent Count-in Padding ("getting-ready"), and the audible
 * Count-in are distinct states to the performer, so the UI can say which one
 * it is in. Arming is dead time ahead of the lead-in, not part of it, but is
 * surfaced through the same phase so one readout covers all of it.
 */
export type LeadInPhase = "arming" | "getting-ready" | "counting-in";

interface TransportState {
  isRecording: boolean;
  isPlaying: boolean;
  /**
   * Whether the capture device is currently held open (ADR 0005). Mirrored
   * from the engine's own armed state — see `onArmedChange` below — so an
   * "Arm"/"Disarm" control reflects what the device is actually doing, not
   * a UI-only preference.
   */
  isArmed: boolean;
  leadInPhase: LeadInPhase | null;
  /**
   * The beats of the Count-in now sounding, empty outside one. Captured from
   * the engine's own plan as the Count-in begins, so the UI displays the same
   * beats the engine sounds rather than a duration recomputed from tempo.
   */
  countInClicks: MetronomeClick[];
  recordingTrackId: string | undefined;
  livePreviewTrackId: string | undefined;

  /** Arms the capture device if unarmed, or releases it if armed — an explicit act, not a preference (ADR 0005). */
  armToggle: () => Promise<void>;
  recordToggle: (trackId?: string) => Promise<void>;
  playToggle: () => Promise<void>;
  reset: () => void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  isRecording: false,
  isPlaying: false,
  isArmed: false,
  leadInPhase: null,
  countInClicks: [],
  recordingTrackId: undefined,
  livePreviewTrackId: undefined,

  armToggle: async () => {
    useProjectStore.setState({ error: null });
    try {
      if (engine.isArmed()) {
        await engine.disarm();
      } else {
        await engine.arm();
      }
    } catch (e) {
      useProjectStore.setState({ error: (e as Error).message });
    }
  },

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
      isArmed: engine.isArmed(),
      leadInPhase: null,
      countInClicks: [],
      recordingTrackId: undefined,
      livePreviewTrackId: undefined,
    }),
}));

// The lead-in's phases all happen inside a single awaited recordTake call,
// so they're mirrored from the engine's own status rather than guessed at
// from timers here — the engine owns when arming ends, getting ready ends,
// and counting in begins, and the UI only reports it.
engine.onStatusChange((status) => {
  const leadInPhase =
    status === "arming" || status === "getting-ready" || status === "counting-in"
      ? status
      : null;
  if (useTransportStore.getState().leadInPhase === leadInPhase) return;
  useTransportStore.setState({
    leadInPhase,
    countInClicks: status === "counting-in" ? engine.getCountInPlan().clicks : [],
  });
});

// Armed is a persistent device state, not a phase of one recordTake call, so
// it's mirrored separately from status.
engine.onArmedChange((armed) => {
  useTransportStore.setState({ isArmed: armed });
});
