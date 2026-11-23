// Modèle de données normalisé, partagé entre le serveur (parseur) et le client (UI).
// Tous les temps sont en millisecondes depuis l'époque Unix (Date.parse du timestamp).

export type LaneType = "main" | "subagent";

export interface Lane {
  id: string; // "main" ou l'agentId du sous-agent
  name: string; // description du sous-agent, ou "Agent principal"
  type: LaneType;
  parentLaneId?: string; // lane qui a lancé ce sous-agent (les sous-agents peuvent être imbriqués)
}

export type SpanType = "thinking" | "tool" | "text" | "subagent";
export type SpanStatus = "ok" | "error" | "running";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  thinking: number; // sous-ensemble de output (output_tokens_details.thinking_tokens)
}

export interface Span {
  id: string; // tool_use id pour un outil, uuid de la ligne sinon
  laneId: string;
  type: SpanType;
  tool?: string; // nom de l'outil (Bash, Read, mcp__x__y...) si type "tool" ou "subagent"
  start: number;
  end: number;
  status: SpanStatus;
  tokens?: TokenUsage; // porté par UN seul span par requête API (évite le double comptage)
  model?: string; // modèle de la requête, présent avec tokens (sert au calcul du coût)
  agentId?: string; // pour type "subagent" : id du sous-agent lancé (= id de sa lane)
  summary: string; // texte court pour l'affichage
  input?: unknown; // arguments de l'outil (pour détecter les appels répétés, les chemins de fichier)
  filePath?: string; // chemin extrait de input.file_path, pour les dépendances "data"
  detail?: string; // extrait du résultat ou du texte, tronqué
  thinkingContent?: string; // toujours absent en pratique : le contenu est vide dans les transcripts
}

export type DependencyType = "spawn" | "result" | "data";

export interface Dependency {
  fromSpanId: string;
  toSpanId: string;
  type: DependencyType;
}

export interface Session {
  id: string; // nom du fichier sans .jsonl
  project: string; // chemin du projet (cwd) ou nom de dossier décodé
  start: number;
  end: number;
  lanes: Lane[];
  spans: Span[];
  dependencies: Dependency[];
}

// Ligne de la liste des sessions (GET /api/sessions), sans le contenu.
export interface SessionSummary {
  id: string;
  project: string;
  start: number;
  end: number;
  subagentCount: number;
}

// ---- Métriques (calculées par src/shared/metrics.ts) ----

// Barème en dollars par million de tokens, chargé depuis config/pricing.json.
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}
export interface Pricing {
  default: ModelPrice; // utilisé si le modèle n'est pas listé
  models: Record<string, ModelPrice>; // clé = préfixe du nom de modèle
}

// Filtre appliqué aux métriques : sous-agent sélectionné et/ou plage de temps.
export interface MetricsFilter {
  laneId?: string;
  from?: number;
  to?: number;
}

export interface ToolStat {
  tool: string;
  count: number;
  totalMs: number;
  errors: number;
}
export interface LaneStat {
  laneId: string;
  name: string;
  toolCalls: number;
  totalMs: number;
  tokens: TokenUsage;
  costUsd: number;
}
// Même outil + mêmes arguments plusieurs fois de suite dans une même lane.
export interface RepeatedCall {
  tool: string;
  inputKey: string; // arguments sérialisés (tronqués)
  count: number;
  spanIds: string[];
}
export interface Metrics {
  durationMs: number; // fin - début de la plage considérée
  tokens: TokenUsage;
  costUsd: number;
  toolCalls: number;
  byTool: ToolStat[];
  byLane: LaneStat[];
  thinkingMs: number;
  actingMs: number; // temps passé dans les outils
  errors: Span[];
  repeated: RepeatedCall[];
}

// ---- Vue "live" (GET /api/live), consommée par le widget macOS ----

// Résumé ultra condensé d'une session récemment active.
export interface LiveSession {
  id: string;
  project: string;
  start: number;
  lastActivity: number; // dernière écriture du transcript (mtime), en ms
  agentsTotal: number; // nombre de sous-agents lancés
  agentsRunning: number; // sous-agents sans fin connue
  agentsDone: number; // agentsTotal - agentsRunning
  hasRunningSpan: boolean; // au moins un span "running" (outil en cours)
  lastAction: string; // résumé du dernier span (par début)
  lastTool?: string;
}
