// Fonctions pures de la timeline (aucun React) : ordre des lanes, spans visibles,
// empilement des spans qui se chevauchent, zoom/pan, graduations et formats.
import type { Lane, Span } from "../../shared/types";

// ---------- Lanes ----------

export interface LaneRow {
  lane: Lane;
  depth: number; // 0 = racine, 1 = sous-agent direct, etc. (sert à l'indentation)
  hasChildren: boolean;
}

// Parcours en profondeur : chaque lane est suivie de ses sous-agents.
// Une lane dont le parent est inconnu est traitée comme une racine (données incomplètes).
export function orderLanes(lanes: Lane[]): LaneRow[] {
  const ids = new Set(lanes.map((l) => l.id));
  const childrenOf = new Map<string, Lane[]>();
  const roots: Lane[] = [];
  for (const lane of lanes) {
    if (lane.parentLaneId && ids.has(lane.parentLaneId) && lane.parentLaneId !== lane.id) {
      const list = childrenOf.get(lane.parentLaneId) ?? [];
      list.push(lane);
      childrenOf.set(lane.parentLaneId, list);
    } else {
      roots.push(lane);
    }
  }
  // "main" d'abord ; le tri est stable, l'ordre d'origine est conservé sinon.
  roots.sort((a, b) => Number(b.type === "main") - Number(a.type === "main"));

  const rows: LaneRow[] = [];
  const seen = new Set<string>(); // protège contre un cycle parent -> enfant -> parent
  const visit = (lane: Lane, depth: number) => {
    if (seen.has(lane.id)) return;
    seen.add(lane.id);
    const children = childrenOf.get(lane.id) ?? [];
    rows.push({ lane, depth, hasChildren: children.length > 0 });
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

// Retire les descendantes des lanes repliées (la lane repliée elle-même reste, en fine bande).
export function visibleLaneRows(rows: LaneRow[], collapsed: Set<string>): LaneRow[] {
  const result: LaneRow[] = [];
  let hideBelowDepth: number | null = null;
  for (const row of rows) {
    if (hideBelowDepth !== null) {
      if (row.depth > hideBelowDepth) continue;
      hideBelowDepth = null;
    }
    result.push(row);
    if (collapsed.has(row.lane.id)) hideBelowDepth = row.depth;
  }
  return result;
}

// ---------- Spans visibles ----------

// Au-delà de ce nombre de spans dans la fenêtre, on masque aussi ceux de moins de 1 px.
export const MANY_SPANS = 1500;
export const MIN_VISIBLE_PX = 0.5;
export const MIN_VISIBLE_PX_CROWDED = 1;

// `spans` doit être trié par start. On coupe d'abord par recherche binaire tout ce qui
// commence après la fin de la fenêtre, puis on filtre le reste. Un simple filtre linéaire
// suffit pour ~5000 spans (quelques dizaines de microsecondes) : pas besoin de structure
// d'intervalles, car les spans peuvent se chevaucher et `end` n'est pas trié.
export function visibleSpans(spans: Span[], t0: number, t1: number, msPerPx: number): Span[] {
  const upper = firstStartAfter(spans, t1);
  const inWindow: Span[] = [];
  for (let i = 0; i < upper; i++) {
    if (spans[i].end >= t0) inWindow.push(spans[i]);
  }
  const minPx = inWindow.length > MANY_SPANS ? MIN_VISIBLE_PX_CROWDED : MIN_VISIBLE_PX;
  // Une erreur reste toujours visible, même minuscule : c'est ce qu'on cherche à repérer.
  return inWindow.filter(
    (s) => s.status === "error" || (s.end - s.start) / msPerPx >= minPx,
  );
}

// ---------- Minimap : regroupement par colonne de pixels ----------

export interface MinimapBlock {
  band: number; // index de la bande (lane)
  x0: number; // colonne de début (pixels, entier)
  x1: number; // colonne de fin exclue
  color: string;
}

// Une minimap de 1200 px ne peut afficher que 1200 colonnes par bande : dessiner 50 000 rects
// est inutile. On marque les colonnes occupées de chaque bande, puis on fusionne les colonnes
// voisines de même couleur en un seul bloc. Le nombre de blocs est donc borné par bandes × largeur.
// Une erreur l'emporte sur les autres spans de sa colonne (comme dans la timeline, elle reste visible).
export function groupMinimapSpans(
  spans: Span[],
  bandOf: Map<string, number>,
  bandCount: number,
  full0: number,
  full1: number,
  width: number,
  colorOf: (span: Span) => string,
  errorColor: string,
): MinimapBlock[] {
  const cols = Math.max(1, Math.ceil(width));
  const pxPerMs = cols / Math.max(1, full1 - full0);
  const grid: (string | undefined)[][] = Array.from({ length: bandCount }, () => new Array(cols));
  for (const s of spans) {
    const band = bandOf.get(s.laneId) ?? 0;
    const first = Math.min(cols - 1, Math.max(0, Math.floor((s.start - full0) * pxPerMs)));
    const last = Math.min(cols - 1, Math.max(first, Math.floor((s.end - full0) * pxPerMs)));
    const color = s.status === "error" ? errorColor : colorOf(s);
    for (let c = first; c <= last; c++) {
      if (grid[band][c] === undefined || color === errorColor) grid[band][c] = color;
    }
  }
  const blocks: MinimapBlock[] = [];
  grid.forEach((row, band) => {
    let c = 0;
    while (c < cols) {
      const color = row[c];
      if (color === undefined) { c++; continue; }
      let end = c + 1;
      while (end < cols && row[end] === color) end++;
      blocks.push({ band, x0: c, x1: end, color });
      c = end;
    }
  });
  return blocks;
}

// Premier index dont le start est > t (spans triés par start).
function firstStartAfter(spans: Span[], t: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sortByStart(spans: Span[]): Span[] {
  return [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---------- Empilement des spans qui se chevauchent ----------

export interface Packing {
  rowOf: Map<string, number>; // id du span -> sous-ligne (0, 1, ...)
  rowCount: number; // au moins 1
}

// Outils lancés en parallèle = spans qui se chevauchent dans une même lane.
// Algorithme glouton : chaque span va sur la première sous-ligne libre. `spans` trié par start.
export function packSpans(spans: Span[]): Packing {
  const rowEnds: number[] = []; // fin du dernier span de chaque sous-ligne
  const rowOf = new Map<string, number>();
  for (const span of spans) {
    let row = rowEnds.findIndex((end) => end <= span.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(span.end);
    } else {
      rowEnds[row] = span.end;
    }
    rowOf.set(span.id, row);
  }
  return { rowOf, rowCount: Math.max(1, rowEnds.length) };
}

// ---------- Fenêtre de temps : zoom / pan ----------

export interface View {
  t0: number;
  t1: number;
}

export const MIN_VIEW_MS = 50; // on ne zoome pas en dessous de 50 ms de large

// Garde la fenêtre dans [full.start, full.end] sans changer sa largeur (sauf si trop large/étroite).
export function clampView(view: View, fullStart: number, fullEnd: number): View {
  const fullSpan = Math.max(1, fullEnd - fullStart);
  const minSpan = Math.min(MIN_VIEW_MS, fullSpan);
  const span = Math.min(fullSpan, Math.max(minSpan, view.t1 - view.t0));
  const t0 = Math.min(Math.max(view.t0, fullStart), fullEnd - span);
  return { t0, t1: t0 + span };
}

// factor < 1 = zoom avant, > 1 = zoom arrière. `frac` (0..1) = position du curseur dans la fenêtre :
// le temps sous le curseur reste immobile à l'écran, c'est ce qui donne un zoom "centré sur le curseur".
export function zoomView(
  view: View,
  frac: number,
  factor: number,
  fullStart: number,
  fullEnd: number,
): View {
  const cursorT = view.t0 + frac * (view.t1 - view.t0);
  const t0 = cursorT - (cursorT - view.t0) * factor;
  const t1 = cursorT + (view.t1 - cursorT) * factor;
  return clampView({ t0, t1 }, fullStart, fullEnd);
}

export function panView(view: View, dtMs: number, fullStart: number, fullEnd: number): View {
  return clampView({ t0: view.t0 + dtMs, t1: view.t1 + dtMs }, fullStart, fullEnd);
}

// ---------- Axe du temps ----------

const TICK_STEPS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000,
  120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000,
];

// Retourne les instants (ms epoch) des graduations, alignés sur des temps relatifs "ronds"
// (+10s, +20s...) par rapport au début de session.
export function timeTicks(
  t0: number,
  t1: number,
  sessionStart: number,
  targetCount: number,
): number[] {
  const wanted = Math.max(1, targetCount);
  const rough = (t1 - t0) / wanted;
  const step = TICK_STEPS_MS.find((s) => s >= rough) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
  const first = Math.ceil((t0 - sessionStart) / step) * step;
  const ticks: number[] = [];
  for (let rel = first; sessionStart + rel <= t1; rel += step) ticks.push(sessionStart + rel);
  return ticks;
}

// ---------- Formats ----------

// "+250ms", "+12s", "+1m20s", "+1h02m"
export function formatRelative(ms: number): string {
  const total = Math.round(ms);
  if (total < 1000) return `+${total}ms`;
  const totalSec = total / 1000;
  if (totalSec < 60) {
    const s = Number.isInteger(totalSec) ? String(totalSec) : totalSec.toFixed(1);
    return `+${s}s`;
  }
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `+${h}h${String(m).padStart(2, "0")}m`;
  return s === 0 ? `+${m}m` : `+${m}m${String(s).padStart(2, "0")}s`;
}

// Durée lisible : "120 ms", "3.4 s", "1m20s".
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return formatRelative(ms).slice(1);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

// Titre d'une carte "thinking" : première phrase, tronquée à ~60 caractères.
export function thinkingTitle(content: string): string {
  const clean = content.trim().replace(/\s+/g, " ");
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? clean : clean.slice(0, end + 1);
  return truncate(sentence, 60);
}
