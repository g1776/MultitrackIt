import type { Track } from "../../src/engine/types";
import { TrackRow } from "./TrackRow";

export function TrackList({ tracks }: { tracks: Track[] }) {
  return (
    <ul>
      {tracks.map((t) => (
        <TrackRow key={t.id} track={t} />
      ))}
    </ul>
  );
}
