import type { Track } from "../../src/engine/types";
import { useProjectStore } from "../store/useProjectStore";
import { useTransportStore } from "../store/useTransportStore";
import { TrackNameInput } from "./controls/TrackNameInput";
import { TakeOffsetInput } from "./controls/TakeOffsetInput";
import { MonitorMixVolumeSlider } from "./controls/MonitorMixVolumeSlider";

export function TrackRow({ track }: { track: Track }) {
  const monitorMixLevels = useProjectStore((s) => s.monitorMixLevels);
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const selectTake = useProjectStore((s) => s.selectTake);
  const setTrackMuteSolo = useProjectStore((s) => s.setTrackMuteSolo);
  const setMonitorMixLevel = useProjectStore((s) => s.setMonitorMixLevel);
  const setTakeOffset = useProjectStore((s) => s.setTakeOffset);

  const isRecording = useTransportStore((s) => s.isRecording);
  const recordingTrackId = useTransportStore((s) => s.recordingTrackId);
  const recordToggle = useTransportStore((s) => s.recordToggle);

  const selectedTake = track.takes.find((t) => t.id === track.selectedTakeId);

  return (
    <li>
      <TrackNameInput name={track.name} onRename={(name) => renameTrack(track.id, name)} />: {track.takes.length}{" "}
      take(s)
      {track.mute ? " (muted)" : ""}
      {track.solo ? " (solo)" : ""}
      <button
        onClick={() => setTrackMuteSolo(track.id, { mute: !track.mute })}
        aria-pressed={track.mute}
        aria-label={`Mute ${track.name}`}
      >
        {track.mute ? "Unmute" : "Mute"}
      </button>
      <button
        onClick={() => setTrackMuteSolo(track.id, { solo: !track.solo })}
        aria-pressed={track.solo}
        aria-label={`Solo ${track.name}`}
      >
        {track.solo ? "Unsolo" : "Solo"}
      </button>
      {track.takes.length > 0 && (
        <select
          value={track.selectedTakeId ?? ""}
          onChange={(e) => selectTake(track.id, e.target.value)}
          aria-label={`Select take for ${track.name}`}
        >
          {track.takes.map((take, i) => (
            <option key={take.id} value={take.id}>
              Take {i + 1}
            </option>
          ))}
        </select>
      )}
      {selectedTake && (
        <TakeOffsetInput
          offsetMs={selectedTake.offsetMs}
          onChange={(offsetMs) => void setTakeOffset(selectedTake.id, offsetMs)}
        />
      )}
      <button onClick={() => void recordToggle(track.id)} disabled={isRecording && recordingTrackId !== track.id}>
        {isRecording && recordingTrackId === track.id ? "Stop Recording" : "Record Take"}
      </button>
      <MonitorMixVolumeSlider
        label={track.name}
        volume={monitorMixLevels[track.id] ?? 1}
        onChange={(level) => setMonitorMixLevel(track.id, level)}
      />
    </li>
  );
}
