import { useProjectStore } from "../store/useProjectStore";
import { MonitorMixVolumeSlider } from "./controls/MonitorMixVolumeSlider";

// Fixed rather than user-configurable: long enough to cover most songs, and
// simpler than asking the user to guess a duration before they've recorded
// anything to measure against.
const METRONOME_GUIDE_DURATION_MS = 5 * 60 * 1000;

export function GuideSection() {
  const guide = useProjectStore((s) => s.project?.guide ?? null);
  const tempoBpm = useProjectStore((s) => s.project?.tempoBpm);
  const monitorMixLevels = useProjectStore((s) => s.monitorMixLevels);
  const importGuide = useProjectStore((s) => s.importGuide);
  const generateMetronomeGuide = useProjectStore((s) => s.generateMetronomeGuide);
  const setGuideIncludeInMonitorMix = useProjectStore((s) => s.setGuideIncludeInMonitorMix);
  const setGuideIncludeInMixdown = useProjectStore((s) => s.setGuideIncludeInMixdown);
  const setMonitorMixLevel = useProjectStore((s) => s.setMonitorMixLevel);

  // Generated at the Project's own tempo and time signature — the Project is
  // the single source of truth for both (see `TempoControls`).
  function handleGenerateMetronomeGuide() {
    generateMetronomeGuide(METRONOME_GUIDE_DURATION_MS);
  }

  return (
    <section>
      <h3>Guide</h3>
      <div className="panel">
        <label>
          Guide (backing track / click):
          <input
            type="file"
            accept="audio/*"
            aria-label="Import Guide"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importGuide(URL.createObjectURL(file));
              e.target.value = "";
            }}
          />
        </label>
        <span className="hint">or</span>
        <button onClick={handleGenerateMetronomeGuide}>
          Generate Metronome Guide at {tempoBpm} BPM
        </button>
      </div>
      {guide && (
        <div className="panel">
          <span className="value">Guide imported</span>
          <label>
            <input
              type="checkbox"
              checked={guide.includeInMonitorMix}
              onChange={(e) => setGuideIncludeInMonitorMix(e.target.checked)}
              aria-label="Include Guide in Monitor Mix"
            />
            Include in Monitor Mix
          </label>
          <label>
            <input
              type="checkbox"
              checked={guide.includeInMixdown}
              onChange={(e) => setGuideIncludeInMixdown(e.target.checked)}
              aria-label="Include Guide in Mixdown"
            />
            Include in Mixdown
          </label>
          <MonitorMixVolumeSlider
            label="Guide"
            volume={monitorMixLevels["guide"] ?? 1}
            onChange={(level) => setMonitorMixLevel("guide", level)}
          />
        </div>
      )}
    </section>
  );
}
