export function MonitorMixVolumeSlider({
  label,
  volume,
  onChange,
}: {
  label: string;
  volume: number;
  onChange: (volume: number) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
      Monitor Mix ({label}):
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Monitor Mix volume for ${label}`}
      />
    </label>
  );
}
