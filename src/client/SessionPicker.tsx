import type { SessionSummary } from "../shared/types";

interface Props {
  sessions: SessionSummary[];
  value: string | null;
  onChange: (id: string) => void;
}

// "/Users/x/code/projet" -> "projet" (gère aussi les chemins Windows)
export function shortProject(project: string): string {
  const parts = project.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? project;
}

function label(s: SessionSummary): string {
  const date = new Date(s.start).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const n = s.subagentCount;
  return `${shortProject(s.project)} · ${date} · ${n} sous-agent${n > 1 ? "s" : ""}`;
}

export function SessionPicker({ sessions, value, onChange }: Props) {
  return (
    <select
      className="session-picker"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Session"
    >
      {sessions.map((s) => (
        <option key={s.id} value={s.id}>
          {label(s)}
        </option>
      ))}
    </select>
  );
}
