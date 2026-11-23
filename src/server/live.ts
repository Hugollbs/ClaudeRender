import type { LiveSession, Session } from "../shared/types.js";
import { DEFAULT_PROJECTS_DIR, listSessions, loadSession } from "./sessions.js";

// Une session est "active" si son transcript a été écrit dans cette fenêtre.
export const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// Fonction pure : résume une session déjà parsée (facile à tester sans fichiers).
export function summarizeLive(session: Session): LiveSession {
  const subagentSpans = session.spans.filter((s) => s.type === "subagent");
  const agentsRunning = subagentSpans.filter((s) => s.status === "running").length;
  // Un span d'agent peut exister sans fichier subagents/ (donc sans lane) : on prend le plus grand des deux.
  const agentsTotal = Math.max(session.lanes.filter((l) => l.type === "subagent").length, subagentSpans.length);

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
    agentsDone: Math.max(0, agentsTotal - agentsRunning),
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
  const results = await Promise.all(
    recent.map(async (summary) => {
      try {
        const session = await loadSession(root, summary.id);
        // lastActivity = mtime du fichier (comme le filtre) : un prompt ou un outil en cours le fait avancer.
        return session ? { ...summarizeLive(session), lastActivity: summary.end } : null;
      } catch (err) {
        // Un transcript illisible ne doit pas faire échouer toute la liste.
        console.warn(`[live] session ignorée : ${summary.id} (${(err as Error).message})`);
        return null;
      }
    }),
  );
  return results.filter((s): s is LiveSession => s !== null).sort((a, b) => b.lastActivity - a.lastActivity);
}
