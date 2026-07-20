import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { generateMetronomeGuideAudio } from "../../src/adapters/metronomeAudio";
import { MetronomeGuideControls } from "./controls/MetronomeGuideControls";
import { MonitorMixVolumeSlider } from "./controls/MonitorMixVolumeSlider";

// Fixed rather than user-configurable: long enough to cover most songs, and
// simpler than asking the user to guess a duration before they've recorded
// anything to measure against.
const METRONOME_GUIDE_DURATION_MS = 5 * 60 * 1000;

export function GuideSection() {
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [metronomeBeatsPerBar, setMetronomeBeatsPerBar] = useState(4);

  const guide = useProjectStore((s) => s.project?.guide ?? null);
  const monitorMixLevels = useProjectStore((s) => s.monitorMixLevels);
  const importGuide = useProjectStore((s) => s.importGuide);
  const setGuideIncludeInMonitorMix = useProjectStore((s) => s.setGuideIncludeInMonitorMix);
  const setGuideIncludeInMixdown = useProjectStore((s) => s.setGuideIncludeInMixdown);
  const setMonitorMixLevel = useProjectStore((s) => s.setMonitorMixLevel);

  function handleGenerateMetronomeGuide() {
    const mediaRef = generateMetronomeGuideAudio({
      bpm: metronomeBpm,
      beatsPerBar: metronomeBeatsPerBar,
      durationMs: METRONOME_GUIDE_DURATION_MS,
    });
    importGuide(mediaRef);
  }

  return (
    <section style={{ marginTop: 8 }}>
      <label>
        Guide (backing track / click):{" "}
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
      {" or "}
      <MetronomeGuideControls
        bpm={metronomeBpm}
        beatsPerBar={metronomeBeatsPerBar}
        onBpmChange={setMetronomeBpm}
        onBeatsPerBarChange={setMetronomeBeatsPerBar}
        onGenerate={handleGenerateMetronomeGuide}
      />
      {guide && (
        <>
          {" (Guide imported) "}
          <label>
            <input
              type="checkbox"
              checked={guide.includeInMonitorMix}
              onChange={(e) => setGuideIncludeInMonitorMix(e.target.checked)}
              aria-label="Include Guide in Monitor Mix"
            />{" "}
            Include in Monitor Mix
          </label>{" "}
          <label>
            <input
              type="checkbox"
              checked={guide.includeInMixdown}
              onChange={(e) => setGuideIncludeInMixdown(e.target.checked)}
              aria-label="Include Guide in Mixdown"
            />{" "}
            Include in Mixdown
          </label>
          <MonitorMixVolumeSlider
            label="Guide"
            volume={monitorMixLevels["guide"] ?? 1}
            onChange={(level) => setMonitorMixLevel("guide", level)}
          />
        </>
      )}
    </section>
  );
}
