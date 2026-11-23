import type { LiveSession, Session } from "../shared/types.js";
import { DEFAULT_PROJECTS_DIR, listSessions, loadSession } from "./sessions.js";

// Une session est "active" si son transcript a été écrit dans cette fenêtre.
export const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// Fonction pure : résume une session déjà parsée (facile à tester sans fichiers).
export function summarizeLive(session: Session): LiveSession {
  const subagentSpans = session.spans.filter((s) => s.type === "subagent");
  const agentsRunning = subagentSpans.filter((s) => s.status === "running").length;
  const agentsTotal = session.lanes.filter((l) => l.type === "subagent").length;

  let last = session.spans[0];
  for (const span of session.spans) {
    if (span.start > last.start) last = span;
  }

  return {
    id: session.id,
    project: session.project,
    start: session.start,
    lastActivity: session.end,
    agentsTotal,
    agentsRunning,
    agentsDone: agentsTotal - agentsRunning,
    hasRunningSpan: session.spans.some((s) => s.status === "running"),
    lastAction: last ? last.summary : "",
    lastTool: last?.tool,
  };
}

// Sessions dont le transcript a bougé dans la fenêtre. On filtre d'abord sur la liste légère
// (mtime) pour ne parser en entier que les quelques sessions réellement actives.
export async function listLive(
  root: string = DEFAULT_PROJECTS_DIR,
  now: number = Date.now(),
  windowMs: number = DEFAULT_ACTIVE_WINDOW_MS,
): Promise<LiveSession[]> {
  const recent = (await listSessions(root)).filter((s) => now - s.end <= windowMs);
  const sessions = await Promise.all(recent.map((s) => loadSession(root, s.id)));
  return sessions
    .filter((s): s is Session => s !== null)
    .map(summarizeLive)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}
