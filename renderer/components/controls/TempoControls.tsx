import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/**
 * The Project's tempo and time signature. Both live on the Project (see
 * `CONTEXT.md`) rather than in local component state, so the value shown here
 * is the same one the metronome Guide is generated from and the one saved
 * with the Project. The BPM field keeps a local *draft* only so half-typed
 * input (an empty field mid-retype) isn't rejected as a non-positive tempo;
 * it commits on blur/Enter like `TakeOffsetInput`.
 */
export function TempoControls() {
  const tempoBpm = useProjectStore((s) => s.project?.tempoBpm);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar);
  const setTempo = useProjectStore((s) => s.setTempo);

  const [bpmDraft, setBpmDraft] = useState(String(tempoBpm ?? ""));

  useEffect(() => setBpmDraft(String(tempoBpm ?? "")), [tempoBpm]);

  if (tempoBpm === undefined || beatsPerBar === undefined) return null;

  function commitBpm() {
    const parsed = Number(bpmDraft);
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== tempoBpm) setTempo({ bpm: parsed });
    else setBpmDraft(String(tempoBpm));
  }

  return (
    <div className="panel">
      <label>
        Tempo (BPM):{" "}
        <input
          type="number"
          min={20}
          max={300}
          value={bpmDraft}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Project tempo in BPM"
          className="input-numeric"
        />
      </label>
      <label>
        Beats per bar:{" "}
        <select
          value={beatsPerBar}
          onChange={(e) => setTempo({ beatsPerBar: Number(e.target.value) })}
          aria-label="Project beats per bar"
        >
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
