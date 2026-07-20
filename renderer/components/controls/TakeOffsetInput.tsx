import { useEffect, useState } from "react";

export function TakeOffsetInput({
  offsetMs,
  onChange,
}: {
  offsetMs: number;
  onChange: (offsetMs: number) => void;
}) {
  const [draft, setDraft] = useState(String(offsetMs));

  useEffect(() => setDraft(String(offsetMs)), [offsetMs]);

  function commit() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== offsetMs) onChange(parsed);
    else setDraft(String(offsetMs));
  }

  return (
    <label style={{ marginLeft: 8 }}>
      Offset (ms):{" "}
      <input
        type="number"
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Take Offset in milliseconds"
        style={{ width: 80 }}
      />
    </label>
  );
}
