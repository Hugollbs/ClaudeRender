// Catégories de spans et couleurs associées (palette pour thème sombre).
// Fichier sans React : utilisable dans les tests et par d'autres panneaux.
import type { DependencyType, Span } from "../../shared/types";

export type Category =
  | "read"
  | "edit"
  | "bash"
  | "web"
  | "thinking"
  | "text"
  | "subagent"
  | "other";

export const CATEGORIES: Category[] = [
  "read",
  "edit",
  "bash",
  "web",
  "thinking",
  "text",
  "subagent",
  "other",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  read: "Lecture",
  edit: "Édition",
  bash: "Bash",
  web: "Recherche web",
  thinking: "Réflexion",
  text: "Texte",
  subagent: "Sous-agent",
  other: "Autre",
};

// Teintes bien séparées (bleu, ambre, vert, cyan, ardoise, gris clair, violet, rose)
// pour rester distinguables sur fond sombre.
export const CATEGORY_COLORS: Record<Category, string> = {
  read: "#4c8bf5",
  edit: "#e5a63c",
  bash: "#7bc043",
  web: "#2ec4c4",
  thinking: "#7d7fa8",
  text: "#cfd3dc",
  subagent: "#a66bd6",
  other: "#d46fa0",
};

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "NotebookRead", "LS"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const BASH_TOOLS = new Set(["Bash", "BashOutput", "KillShell", "Monitor"]);
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

// Le type du span prime sur le nom d'outil : un span "thinking" n'a pas d'outil,
// et un sous-agent est lancé par un outil (Task/Agent) qu'on ne veut pas classer en "autre".
export function spanCategory(span: Pick<Span, "type" | "tool">): Category {
  if (span.type === "thinking") return "thinking";
  if (span.type === "text") return "text";
  if (span.type === "subagent") return "subagent";
  const tool = span.tool ?? "";
  if (READ_TOOLS.has(tool)) return "read";
  if (EDIT_TOOLS.has(tool)) return "edit";
  if (BASH_TOOLS.has(tool)) return "bash";
  if (WEB_TOOLS.has(tool)) return "web";
  return "other"; // inclut mcp__*
}

export const DEPENDENCY_TYPES: DependencyType[] = ["spawn", "result", "data"];

export const DEPENDENCY_STYLES: Record<
  DependencyType,
  { color: string; dash: string | undefined; label: string }
> = {
  spawn: { color: "#e5a63c", dash: undefined, label: "spawn" },
  result: { color: "#5fd0ff", dash: undefined, label: "result" },
  data: { color: "#b8bccb", dash: "4 3", label: "data" },
};
