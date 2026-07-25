import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { DEFAULT_BEATS_PER_BAR, DEFAULT_TEMPO_BPM } from "../../src/engine/RecordingEngine";

export function ProjectPicker() {
  const [projectName, setProjectName] = useState("");
  // Tempo and time signature are fixed at creation and read-only thereafter,
  // so they're asked for here rather than offered as editable Project
  // settings. Kept as a string draft so the field can be cleared mid-retype.
  const [bpm, setBpm] = useState(String(DEFAULT_TEMPO_BPM));
  const [beatsPerBar, setBeatsPerBar] = useState(DEFAULT_BEATS_PER_BAR);
  const savedProjects = useProjectStore((s) => s.savedProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const loadProject = useProjectStore((s) => s.loadProject);

  return (
    <section>
      <div className="panel">
        <input
          className="input-name"
          placeholder="Project name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        <label>
          Tempo (BPM):{" "}
          <input
            type="number"
            min={20}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            aria-label="Project tempo in BPM"
            className="input-numeric"
          />
        </label>
        <label>
          Beats per bar:{" "}
          <select
            value={beatsPerBar}
            onChange={(e) => setBeatsPerBar(Number(e.target.value))}
            aria-label="Project beats per bar"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => createProject(projectName, { bpm: Number(bpm), beatsPerBar })}>
          Create Project
        </button>
      </div>
      <p className="hint">Tempo and time signature are fixed once the Project is created.</p>

      {savedProjects.length > 0 && (
        <ul className="project-list">
          {savedProjects.map((p) => (
            <li key={p.id}>
              {p.name} <button onClick={() => void loadProject(p.id)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
