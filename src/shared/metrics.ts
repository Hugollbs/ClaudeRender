// Calcul des métriques d'une session. Fonction pure : pas d'I/O, pour être testable
// et utilisable aussi bien côté serveur que côté client.
import type {
  LaneStat,
  Metrics,
  MetricsFilter,
  ModelPrice,
  Pricing,
  RepeatedCall,
  Session,
  Span,
  TokenUsage,
  ToolStat,
} from "./types";

const INPUT_KEY_MAX_LENGTH = 120;
const MIN_REPEAT = 2;
// Nom sous lequel on range les spans "subagent" dans byTool si le span n'a pas de tool.
const SUBAGENT_TOOL_NAME = "Agent";

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 };
}

function addTokens(total: TokenUsage, t: TokenUsage): void {
  total.input += t.input;
  total.output += t.output;
  total.cacheRead += t.cacheRead;
  total.cacheCreation += t.cacheCreation;
  total.thinking += t.thinking;
}

// Prix du modèle : la clé la plus longue qui est préfixe du nom gagne
// (ex. "claude-opus-4" doit l'emporter sur "claude-opus").
function findPrice(model: string | undefined, pricing: Pricing): ModelPrice {
  if (!model) return pricing.default;
  let best: ModelPrice | undefined;
  let bestLength = -1;
  for (const [prefix, price] of Object.entries(pricing.models)) {
    if (model.startsWith(prefix) && prefix.length > bestLength) {
      best = price;
      bestLength = prefix.length;
    }
  }
  return best ?? pricing.default;
}

function spanCost(tokens: TokenUsage, price: ModelPrice): number {
  // output contient déjà les tokens de réflexion : on n'ajoute pas "thinking".
  const total =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheCreation * price.cacheCreation;
  return total / 1e6;
}

// La lane demandée + toutes ses descendantes (les sous-agents peuvent être imbriqués).
function laneAndDescendants(session: Session, laneId: string): Set<string> {
  const ids = new Set<string>([laneId]);
  let changed = true;
  // On repasse tant qu'on trouve de nouveaux enfants (évite d'imposer un ordre aux lanes).
  while (changed) {
    changed = false;
    for (const lane of session.lanes) {
      if (lane.parentLaneId && ids.has(lane.parentLaneId) && !ids.has(lane.id)) {
        ids.add(lane.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function computeMetrics(session: Session, filter: MetricsFilter, pricing: Pricing): Metrics {
  const { from, to } = filter;
  const allowedLanes = filter.laneId !== undefined ? laneAndDescendants(session, filter.laneId) : null;

  // Partie du span qui tombe dans la plage [from, to] (clipping).
  // Sans plage, c'est la durée complète.
  const clippedMs = (span: Span): number => {
    const start = from !== undefined ? Math.max(span.start, from) : span.start;
    const end = to !== undefined ? Math.min(span.end, to) : span.end;
    return Math.max(0, end - start);
  };

  // Un span est gardé s'il est dans une lane retenue et chevauche la plage.
  // On compare avec <= / >= pour garder aussi un span instantané (start == end) dans la plage.
  const kept = session.spans.filter((span) => {
    if (allowedLanes && !allowedLanes.has(span.laneId)) return false;
    if (from !== undefined && span.end < from) return false;
    if (to !== undefined && span.start > to) return false;
    return true;
  });

  let durationMs = 0;
  if (from !== undefined && to !== undefined) {
    durationMs = Math.max(0, to - from);
  } else if (kept.length > 0) {
    // reduce plutôt que Math.max(...tableau) : le spread plante au-delà de ~120 000 éléments.
    const lastEnd = kept.reduce((m, s) => Math.max(m, s.end), -Infinity);
    const firstStart = kept.reduce((m, s) => Math.min(m, s.start), Infinity);
    durationMs = lastEnd - firstStart;
  }

  const tokens = emptyTokens();
  let costUsd = 0;
  let toolCalls = 0;
  let thinkingMs = 0;
  let actingMs = 0;
  const errors: Span[] = [];
  const toolStats = new Map<string, ToolStat>();
  const laneStats = new Map<string, LaneStat>();

  const nameOfLane = (id: string): string => session.lanes.find((l) => l.id === id)?.name ?? id;
  const getLaneStat = (id: string): LaneStat => {
    let stat = laneStats.get(id);
    if (!stat) {
      stat = { laneId: id, name: nameOfLane(id), toolCalls: 0, totalMs: 0, tokens: emptyTokens(), costUsd: 0 };
      laneStats.set(id, stat);
    }
    return stat;
  };

  for (const span of kept) {
    const ms = clippedMs(span);
    const laneStat = getLaneStat(span.laneId);

    if (span.status === "error") errors.push(span);

    // Seul un span par requête porte les tokens : pas de double comptage.
    if (span.tokens) {
      const cost = spanCost(span.tokens, findPrice(span.model, pricing));
      addTokens(tokens, span.tokens);
      addTokens(laneStat.tokens, span.tokens);
      costUsd += cost;
      laneStat.costUsd += cost;
    }

    if (span.type === "tool") {
      toolCalls++;
      actingMs += ms;
      laneStat.toolCalls++;
      laneStat.totalMs += ms;
    } else if (span.type === "thinking") {
      thinkingMs += ms;
      laneStat.totalMs += ms;
    }
    // Les spans "subagent" ne comptent ni dans toolCalls ni dans actingMs ni dans le temps
    // de la lane : leur durée est déjà couverte par le travail de la lane du sous-agent.

    // Choix : on range les spans "subagent" dans byTool (sous "Agent") pour voir
    // combien de temps on attend les sous-agents. Ils n'augmentent pas toolCalls,
    // donc la somme des count de byTool peut dépasser toolCalls.
    if (span.type === "tool" || span.type === "subagent") {
      const name = span.tool ?? (span.type === "subagent" ? SUBAGENT_TOOL_NAME : "unknown");
      let stat = toolStats.get(name);
      if (!stat) {
        stat = { tool: name, count: 0, totalMs: 0, errors: 0 };
        toolStats.set(name, stat);
      }
      stat.count++;
      stat.totalMs += ms;
      if (span.status === "error") stat.errors++;
    }
  }

  const byTool = [...toolStats.values()].sort((a, b) => b.totalMs - a.totalMs);
  const byLane = [...laneStats.values()];

  return {
    durationMs,
    tokens,
    costUsd,
    toolCalls,
    byTool,
    byLane,
    thinkingMs,
    actingMs,
    errors,
    repeated: findRepeatedCalls(kept),
  };
}

// Appels répétés : même outil + mêmes arguments, consécutifs dans une même lane.
// Les spans thinking/text entre deux appels n'interrompent pas la suite
// (on ne regarde que les spans "tool") ; un autre outil l'interrompt.
function findRepeatedCalls(spans: Span[]): RepeatedCall[] {
  const byLane = new Map<string, Span[]>();
  for (const span of spans) {
    if (span.type !== "tool") continue;
    const list = byLane.get(span.laneId) ?? [];
    list.push(span);
    byLane.set(span.laneId, list);
  }

  const result: RepeatedCall[] = [];
  for (const laneSpans of byLane.values()) {
    laneSpans.sort((a, b) => a.start - b.start);

    let run: Span[] = [];
    let runKey = "";
    let runId = "";
    // Ferme la suite en cours : on ne la garde que si elle est assez longue.
    const closeRun = () => {
      if (run.length >= MIN_REPEAT) {
        result.push({
          tool: run[0].tool ?? "unknown",
          inputKey: runKey.slice(0, INPUT_KEY_MAX_LENGTH),
          count: run.length,
          spanIds: run.map((s) => s.id),
        });
      }
      run = [];
    };

    for (const span of laneSpans) {
      // Le nom d'outil est dans la clé pour que deux outils différents ne se confondent pas.
      const key = `${span.tool ?? ""}\u0000${fullInput(span)}`;
      if (run.length > 0 && key !== runId) closeRun();
      if (run.length === 0) {
        runId = key;
        runKey = fullInput(span);
      }
      run.push(span);
    }
    closeRun();
  }
  return result;
}

function fullInput(span: Span): string {
  // JSON.stringify(undefined) renvoie undefined : on le remplace pour avoir toujours une chaîne.
  return JSON.stringify(span.input) ?? "";
}
