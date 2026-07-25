export function MetronomeGuideControls({
  bpm,
  beatsPerBar,
  onBpmChange,
  onBeatsPerBarChange,
  onGenerate,
}: {
  bpm: number;
  beatsPerBar: number;
  onBpmChange: (bpm: number) => void;
  onBeatsPerBarChange: (beatsPerBar: number) => void;
  onGenerate: () => void;
}) {
  return (
    <span className="control-group">
      <label>
        BPM:{" "}
        <input
          type="number"
          min={20}
          max={300}
          value={bpm}
          onChange={(e) => onBpmChange(Number(e.target.value))}
          aria-label="Metronome BPM"
          className="input-numeric"
        />
      </label>
      <label>
        Beats per bar:{" "}
        <select
          value={beatsPerBar}
          onChange={(e) => onBeatsPerBarChange(Number(e.target.value))}
          aria-label="Metronome beats per bar"
        >
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button onClick={onGenerate}>Generate Metronome Guide</button>
    </span>
  );
}
