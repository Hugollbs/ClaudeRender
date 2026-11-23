// Transforme les fichiers JSONL d'une session Claude Code en modèle normalisé (Session).
// Le format a été observé sur de vrais transcripts ; les points non évidents sont commentés.
import type { Dependency, Lane, Session, Span, TokenUsage } from "../shared/types";

export interface RawSubagent {
  agentId: string;
  text: string; // contenu brut du fichier agent-<id>.jsonl
  meta?: { toolUseId?: string; description?: string; agentType?: string };
}

const MAX_DETAIL = 500; // on tronque les extraits pour garder un JSON léger
const MAX_SUMMARY = 80;
const AGENT_TOOLS = new Set(["Agent", "Task"]); // l'outil qui lance un sous-agent
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read"]);

// Une ligne JSON de transcript : on ne type que les champs dont on se sert.
interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  requestId?: string;
  cwd?: string;
  thinkingDurationMs?: number;
  toolUseResult?: any;
  message?: { model?: string; usage?: any; content?: any };
}

// Résultat du parsing d'un fichier (une lane).
interface LaneParse {
  spans: Span[];
  cwd?: string;
  // tool_use id de l'Agent -> agentId, lu dans le tool_result "async_launched"
  launches: Map<string, string>;
  // tool_use id de l'Agent -> fin réelle (task-notification)
  notifications: Map<string, { ts: number; status: string }>;
}

// Ce que la lane principale partage avec les sous-agents pour éviter les doublons.
interface Shared {
  seenRequestIds: Set<string>;
}

function parseLines(text: string): Line[] {
  const lines: Line[] = [];
  let invalid = 0;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Une ligne tronquée (session en cours d'écriture) ne doit pas casser toute la session.
      invalid++;
    }
  }
  if (invalid > 0) console.warn(`${invalid} ligne(s) JSONL invalide(s) ignorée(s)`);
  return lines;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function toTokens(usage: any): TokenUsage {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheCreation: usage?.cache_creation_input_tokens ?? 0,
    thinking: usage?.output_tokens_details?.thinking_tokens ?? 0,
  };
}

// Texte court décrivant un appel d'outil, selon ses arguments.
function summarizeTool(name: string, input: any): string {
  const first = (...keys: string[]) => keys.map((k) => input?.[k]).find((v) => typeof v === "string");
  const text = first("description", "file_path", "notebook_path", "pattern", "query", "url", "command", "prompt");
  return truncate(text ?? name, MAX_SUMMARY);
}

function resultToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b?.text === "string" ? b.text : "")).join(" ");
  }
  return "";
}

// Lit le contenu d'une <task-notification> (envoyée au parent quand un agent async se termine).
function parseNotification(content: string): { toolUseId: string; status: string } | null {
  if (!content.includes("<task-notification>")) return null;
  const toolUseId = content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1];
  const status = content.match(/<status>([^<]+)<\/status>/)?.[1];
  return toolUseId && status ? { toolUseId, status } : null;
}

function parseLane(text: string, laneId: string, shared: Shared, isMain: boolean): LaneParse {
  const result: LaneParse = { spans: [], launches: new Map(), notifications: new Map() };
  const pending = new Map<string, Span>(); // tool_use id -> span en attente de son résultat
  let previousTs: number | null = null; // sert à estimer le début d'un bloc de texte

  for (const line of parseLines(text)) {
    if ((line.type !== "user" && line.type !== "assistant") || !line.timestamp) continue;
    const ts = Date.parse(line.timestamp);
    if (Number.isNaN(ts)) continue;
    result.cwd ??= line.cwd;
    const content = line.message?.content;

    if (line.type === "assistant" && Array.isArray(content)) {
      // Chaque bloc d'un même message API est sur sa propre ligne, avec le même usage recopié.
      // On ne garde donc les tokens qu'une fois par requestId, sur le premier span.
      let tokens: TokenUsage | undefined;
      const requestId = line.requestId;
      if (requestId && !shared.seenRequestIds.has(requestId)) {
        shared.seenRequestIds.add(requestId);
        tokens = toTokens(line.message?.usage);
      } else if (!requestId && isMain) {
        tokens = toTokens(line.message?.usage);
      }
      const model = line.message?.model;
      let blockIndex = 0;

      for (const block of content) {
        const spanIdBase = `${laneId}:${line.uuid ?? ts}#${blockIndex++}`;
        let span: Span | null = null;

        if (block.type === "thinking") {
          const raw = line.thinkingDurationMs;
          const duration = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
          span = {
            id: spanIdBase, laneId, type: "thinking", start: ts - duration, end: ts, status: "ok",
            summary: `Réflexion (${(duration / 1000).toFixed(1)} s)`,
          };
          // Le contenu est vide dans les transcripts actuels ; on ne le garde que s'il existe.
          if (block.thinking) span.thinkingContent = block.thinking;
        } else if (block.type === "text") {
          span = {
            id: spanIdBase, laneId, type: "text", start: Math.min(previousTs ?? ts, ts), end: ts, status: "ok", // min : timestamps parfois non monotones
            
            summary: truncate(block.text ?? "", MAX_SUMMARY), detail: truncate(block.text ?? "", MAX_DETAIL),
          };
        } else if (block.type === "tool_use") {
          const input = block.input ?? {};
          const filePath = input.file_path ?? input.notebook_path;
          span = {
            id: block.id, laneId, type: AGENT_TOOLS.has(block.name) ? "subagent" : "tool", tool: block.name,
            start: ts, end: ts, status: "running", summary: summarizeTool(block.name, input), input,
            ...(typeof filePath === "string" ? { filePath } : {}),
          };
          pending.set(block.id, span);
        }

        if (span) {
          if (tokens) {
            span.tokens = tokens;
            span.model = model;
            tokens = undefined; // un seul span porte les tokens de la requête
          }
          result.spans.push(span);
        }
      }
    }

    if (line.type === "user") {
      if (typeof content === "string") {
        const notif = parseNotification(content);
        if (notif) result.notifications.set(notif.toolUseId, { ts, status: notif.status });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const span = pending.get(block.tool_use_id);
          if (!span) continue;
          pending.delete(block.tool_use_id);
          span.end = ts;
          span.status = block.is_error ? "error" : "ok";
          span.detail = truncate(resultToText(block.content), MAX_DETAIL);
          // Un agent lancé en arrière-plan répond tout de suite : sa vraie fin viendra plus tard.
          const launch = line.toolUseResult;
          if (span.type === "subagent" && launch?.agentId && launch?.status === "async_launched") {
            result.launches.set(span.id, launch.agentId);
            span.agentId = launch.agentId;
          }
        }
      }
    }
    previousTs = ts;
  }
  return result;
}

// Dépendance "data" : un fichier écrit puis relu. On relie une écriture à la PREMIÈRE lecture
// qui suit, pour ne pas noyer la timeline de flèches. C'est une approximation :
// rien ne prouve que la lecture a vraiment utilisé la donnée écrite.
function detectDataDependencies(spans: Span[]): Dependency[] {
  const deps: Dependency[] = [];
  const lastWrite = new Map<string, { span: Span; linked: boolean }>();
  const byTime = spans.filter((s) => s.type === "tool" && s.filePath).sort((a, b) => a.start - b.start);
  for (const span of byTime) {
    const path = span.filePath as string;
    if (WRITE_TOOLS.has(span.tool ?? "")) {
      lastWrite.set(path, { span, linked: false });
    } else if (READ_TOOLS.has(span.tool ?? "")) {
      const write = lastWrite.get(path);
      if (write && !write.linked && write.span.end <= span.start) {
        deps.push({ fromSpanId: write.span.id, toSpanId: span.id, type: "data" });
        write.linked = true;
      }
    }
  }
  return deps;
}

// Le fichier d'un sous-agent "fork" rejoue l'appel Agent du parent (même tool_use id).
// On garde l'exemplaire qui a reçu un résultat (l'original), sinon le premier rencontré.
function dropReplayedToolUses(spans: Span[]): Span[] {
  const best = new Map<string, Span>();
  for (const span of spans) {
    if (span.type === "thinking" || span.type === "text") continue;
    const known = best.get(span.id);
    if (!known || (known.status === "running" && span.status !== "running")) best.set(span.id, span);
  }
  return spans.filter((s) => s.type === "thinking" || s.type === "text" || best.get(s.id) === s);
}

export function parseSession(id: string, mainText: string, subagents: RawSubagent[]): Session {
  const shared: Shared = { seenRequestIds: new Set() };
  const main = parseLane(mainText, "main", shared, true);
  const subParses = subagents.map((s) => ({ raw: s, parse: parseLane(s.text, s.agentId, shared, false) }));
  const allParses = [main, ...subParses.map((s) => s.parse)];

  const spans = dropReplayedToolUses(allParses.flatMap((p) => p.spans));
  const spanById = new Map(spans.map((s) => [s.id, s]));
  const notifications = new Map(allParses.flatMap((p) => [...p.notifications]));

  // Lien parent -> sous-agent : agentId lu dans le tool_result, sinon toolUseId du .meta.json.
  const agentSpanOf = new Map<string, Span>(); // agentId -> span Agent dans le parent
  for (const p of allParses) {
    for (const [toolUseId, agentId] of p.launches) {
      const span = spanById.get(toolUseId);
      if (span) agentSpanOf.set(agentId, span);
    }
  }
  for (const { raw } of subParses) {
    const fromMeta = raw.meta?.toolUseId ? spanById.get(raw.meta.toolUseId) : undefined;
    if (fromMeta && !agentSpanOf.has(raw.agentId)) {
      fromMeta.agentId = raw.agentId;
      agentSpanOf.set(raw.agentId, fromMeta);
    }
  }

  const lanes: Lane[] = [{ id: "main", name: "Agent principal", type: "main" }];
  const dependencies: Dependency[] = [];
  for (const { raw, parse } of subParses) {
    const agentSpan = agentSpanOf.get(raw.agentId);
    const description = raw.meta?.description ?? (agentSpan?.input as any)?.description;
    lanes.push({
      id: raw.agentId, name: description ?? raw.agentId, type: "subagent",
      parentLaneId: agentSpan?.laneId ?? "main",
    });

    // On repart de `spans` (déjà dédoublonnés), pas de parse.spans qui contient l'appel rejoué.
    const laneSpans = spans.filter((s) => s.laneId === raw.agentId);
    if (laneSpans.length === 0 || !agentSpan) continue;
    const ordered = [...laneSpans].sort((a, b) => a.start - b.start);
    dependencies.push({ fromSpanId: agentSpan.id, toSpanId: ordered[0].id, type: "spawn" });
    const last = ordered.reduce((a, b) => (b.end >= a.end ? b : a));
    dependencies.push({ fromSpanId: last.id, toSpanId: agentSpan.id, type: "result" });
  }

  // Fin réelle des agents lancés en arrière-plan : la notification, sinon la dernière activité
  // connue. Fait ici, hors de la boucle des lanes, pour que la notification soit appliquée
  // même si le fichier du sous-agent est absent ou vide.
  const asyncLaunched = new Set(allParses.flatMap((p) => [...p.launches.keys()]));
  for (const span of spans) {
    if (!asyncLaunched.has(span.id)) continue; // un agent synchrone garde le statut de son tool_result
    const notif = notifications.get(span.id);
    if (notif) {
      span.end = Math.max(span.end, notif.ts);
      span.status = notif.status === "completed" ? "ok" : "error";
    } else {
      const subEnd = spans.filter((s) => s.laneId === span.agentId).reduce((m, s) => Math.max(m, s.end), 0);
      span.end = Math.max(span.end, subEnd);
      span.status = "running"; // pas de notification de fin dans le transcript : on ne l'invente pas
    }
  }
  dependencies.push(...detectDataDependencies(spans));

  // reduce plutôt que Math.min(...tableau) : le spread plante sur de très longues sessions.
  const start = spans.reduce((m, s) => Math.min(m, s.start), Infinity);
  const end = spans.reduce((m, s) => Math.max(m, s.end), -Infinity);
  return {
    id,
    project: main.cwd ?? id,
    start: spans.length ? start : 0,
    end: spans.length ? end : 0,
    lanes,
    spans,
    dependencies,
  };
}
