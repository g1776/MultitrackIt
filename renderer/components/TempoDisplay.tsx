import { useProjectStore } from "../store/useProjectStore";

/**
 * The Project's tempo and time signature, shown read-only: both are fixed at
 * creation (see `RecordingEngine.createProject`), so this is a reminder of
 * what the Project is at, not a control.
 */
export function TempoDisplay() {
  const tempoBpm = useProjectStore((s) => s.project?.tempoBpm);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar);

  if (tempoBpm === undefined || beatsPerBar === undefined) return null;

  return (
    <div className="panel">
      <span className="value">
        {tempoBpm} BPM · {beatsPerBar} beats/bar
      </span>
    </div>
  );
}
