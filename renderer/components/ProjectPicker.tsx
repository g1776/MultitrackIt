import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";

export function ProjectPicker() {
  const [projectName, setProjectName] = useState("");
  const savedProjects = useProjectStore((s) => s.savedProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const loadProject = useProjectStore((s) => s.loadProject);

  return (
    <section>
      <input
        placeholder="Project name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
      />
      <button onClick={() => createProject(projectName)}>Create Project</button>

      {savedProjects.length > 0 && (
        <ul>
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
