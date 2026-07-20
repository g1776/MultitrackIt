import { useEffect, useState } from "react";

export function TrackNameInput({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);

  useEffect(() => setDraft(name), [name]);

  function commit() {
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
    else setDraft(name);
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label={`Rename ${name}`}
      style={{ width: 120 }}
    />
  );
}
