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
}

export interface Project {
  name: string;
  tracks: Track[];
  guide: Guide | null;
}

export interface MonitorMixLevel {
  /** Track id or the reserved "guide" id. */
  targetId: TrackId | "guide";
  level: number;
}

export type EngineStatus = "idle" | "recording" | "playing";
