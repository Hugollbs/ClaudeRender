import { memo, useMemo } from "react";
import type { Span } from "../../shared/types";
import { CATEGORY_COLORS, spanCategory } from "./colors";
import { visibleSpans, type LaneRow as LaneRowData } from "./layout";

// Dimensions partagées avec Timeline.tsx
export const SUB_H = 16; // hauteur d'un span
export const SUB_GAP = 2;
export const LANE_PAD = 5;
export const COLLAPSED_H = 10; // hauteur d'une lane repliée (fine bande)
const MIN_SPAN_PX = 2; // un span court reste visible
const LABEL_MIN_PX = 70; // en dessous, pas de texte dans le rectangle
const CHAR_PX = 6.2;

// ---------- Libellé (colonne de gauche) ----------

interface LabelProps {
  row: LaneRowData;
  y: number;
  height: number;
  width: number;
  collapsed: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

export function LaneLabel({ row, y, height, width, collapsed, selected, onToggle, onSelect }: LabelProps) {
  const indent = 8 + row.depth * 14;
  const canCollapse = row.lane.type === "subagent" || row.hasChildren;
  const textX = indent + (canCollapse ? 16 : 0);
  const maxChars = Math.max(3, Math.floor((width - textX - 6) / 6.5));
  const name = row.lane.name.length > maxChars ? row.lane.name.slice(0, maxChars - 1) + "…" : row.lane.name;
  const textY = collapsed ? y + height / 2 + 4 : y + 18;

  return (
    <g className={selected ? "tl-lane-label selected" : "tl-lane-label"}>
      <rect x={0} y={y} width={width} height={height} className="tl-label-bg" onClick={onSelect} />
      {canCollapse && (
        <text x={indent} y={textY} className="tl-toggle" onClick={onToggle}>
          {collapsed ? "▸" : "▾"}
        </text>
      )}
      <text x={textX} y={textY} className="tl-lane-name" onClick={onSelect}>
        {name}
        <title>{row.lane.name}</title>
      </text>
    </g>
  );
}

// ---------- Spans d'une lane ----------

interface SpansProps {
  spans: Span[]; // triés par start
  rowOf: Map<string, number>;
  y: number;
  collapsed: boolean;
  dimmed: boolean;
  t0: number;
  t1: number;
  plotWidth: number;
  selectedSpanId: string | null;
  onHover: (span: Span, e: React.PointerEvent) => void;
  onLeave: () => void;
  onClickSpan: (span: Span) => void;
}

// memo : le survol change l'état de Timeline à chaque span traversé ; sans memo
// on redessinerait tous les rectangles à chaque fois.
export const LaneSpans = memo(function LaneSpans(p: SpansProps) {
  const msPerPx = (p.t1 - p.t0) / p.plotWidth;
  const visible = useMemo(
    () => visibleSpans(p.spans, p.t0, p.t1, msPerPx),
    [p.spans, p.t0, p.t1, msPerPx],
  );
  const toX = (t: number) => ((t - p.t0) / (p.t1 - p.t0)) * p.plotWidth;

  return (
    <g opacity={p.dimmed ? 0.4 : 1}>
      {visible.map((span) => {
        const category = spanCategory(span);
        const x = toX(span.start);
        const w = Math.max(MIN_SPAN_PX, toX(span.end) - x);
        const row = p.collapsed ? 0 : (p.rowOf.get(span.id) ?? 0);
        const h = p.collapsed ? 4 : span.type === "thinking" ? SUB_H - 4 : SUB_H;
        const top = p.collapsed
          ? p.y + 3
          : p.y + LANE_PAD + row * (SUB_H + SUB_GAP) + (SUB_H - h) / 2;
        const selected = span.id === p.selectedSpanId;
        const classes = ["tl-span"];
        if (span.status === "error") classes.push("error");
        if (span.status === "running") classes.push("running");
        if (selected) classes.push("selected");
        return (
          <g key={span.id}>
            <rect
              className={classes.join(" ")}
              x={x}
              y={top}
              width={w}
              height={h}
              rx={span.type === "thinking" ? 4 : 2} // les "cartes" thinking sont plus arrondies
              fill={CATEGORY_COLORS[category]}
              onPointerEnter={(e) => p.onHover(span, e)}
              onPointerLeave={p.onLeave}
              onClick={() => p.onClickSpan(span)}
            />
            {!p.collapsed && w >= LABEL_MIN_PX && (
              <text className="tl-span-text" x={x + 4} y={top + h / 2 + 3.5}>
                {labelFor(span, Math.floor((w - 8) / CHAR_PX))}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

function labelFor(span: Span, maxChars: number): string {
  const text = span.tool ?? (span.type === "thinking" ? "réflexion" : span.type);
  return text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + "…" : text;
}
