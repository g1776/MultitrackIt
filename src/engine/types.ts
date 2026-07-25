export type TrackId = string;
export type TakeId = string;

export interface Take {
  id: TakeId;
  trackId: TrackId;
  /** Opaque handle to the recorded media, produced by the capture adapter. */
  mediaRef: string;
  offsetMs: number;
  createdAt: number;
}

export interface Track {
  id: TrackId;
  name: string;
  takes: Take[];
  selectedTakeId: TakeId | null;
  mute: boolean;
  solo: boolean;
}

export interface Guide {
  /** Opaque handle to the imported reference audio, produced by the import adapter. */
  mediaRef: string;
  /** Whether the Guide is audible in the Monitor Mix while recording. */
  includeInMonitorMix: boolean;
  /** Whether the Guide is included in composite playback and exported Mixdowns. */
  includeInMixdown: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
  guide: Guide | null;
  /**
   * The piece's tempo in beats per minute. Belongs to the Project rather
   * than the Guide: every Track is performed against the same tempo, and an
   * imported Guide has no knowable tempo while its Project still needs one.
   */
  tempoBpm: number;
  /** The time signature's beats per bar (its numerator, e.g. 4 for 4/4). */
  beatsPerBar: number;
}

export interface MonitorMixLevel {
  /** Track id or the reserved "guide" id. */
  targetId: TrackId | "guide";
  level: number;
}

export type EngineStatus = "idle" | "counting-in" | "recording" | "playing";
