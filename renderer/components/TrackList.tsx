import type { Track } from "../../src/engine/types";
import { TrackRow } from "./TrackRow";

export function TrackList({ tracks }: { tracks: Track[] }) {
  // Nothing rather than a bare "Tracks" heading over an empty list: before a
  // Project has any Track, the heading would only add a section separator
  // around nothing.
  if (tracks.length === 0) return null;

  return (
    <section>
      <h3>Tracks</h3>
      <ul className="track-list">
        {tracks.map((t) => (
          <TrackRow key={t.id} track={t} />
        ))}
      </ul>
    </section>
  );
}
