import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import type { DependencyType, Session, Span } from "../../shared/types";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DEPENDENCY_STYLES,
  DEPENDENCY_TYPES,
} from "./colors";
import {
  formatDuration,
  formatRelative,
  orderLanes,
  packSpans,
  panView,
  sortByStart,
  timeTicks,
  visibleLaneRows,
  type Packing,
} from "./layout";
import { Dependencies, DependencyDefs } from "./Dependencies";
import { COLLAPSED_H, LANE_PAD, LaneLabel, LaneSpans, SUB_GAP, SUB_H } from "./LaneRow";
import { Minimap } from "./Minimap";
import { Tooltip, type HoverInfo } from "./Tooltip";
import { useElementWidth } from "./useElementWidth";
import { trackDrag, useZoomPan } from "./useZoomPan";
import "./timeline.css";

export interface TimelineProps {
  session: Session;
  selectedLaneId: string | null; // sous-agent sélectionné (null = tout)
  onSelectLane: (laneId: string | null) => void;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string | null) => void;
  range: [number, number] | null; // plage sélectionnée (ms epoch), null = aucune
  onRangeChange: (range: [number, number] | null) => void;
}

const LABEL_W = 180; // colonne des noms de lanes
const RIGHT_PAD = 10;
const AXIS_H = 26;
const LANE_GAP = 1;
const MIN_DRAG_PX = 3; // en dessous, c'est un clic et non un glisser
const TICK_SPACING_PX = 90;

interface LaneData {
  spans: Span[]; // triés par start (nécessaire à la virtualisation)
  packing: Packing;
}

export function Timeline(props: TimelineProps) {
  const { session, selectedLaneId, selectedSpanId, range } = props;
  const { onSelectLane, onSelectSpan, onRangeChange } = props;

  const chartRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<SVGSVGElement>(null);
  const movedRef = useRef(false); // un glisser vient d'avoir lieu : on ignore le "click" qui suit

  const width = useElementWidth(chartRef);
  const plotW = Math.max(100, width - LABEL_W - RIGHT_PAD);
  const fullStart = session.start;
  const fullEnd = Math.max(session.end, session.start + 1);
  const { view, setView, resetView } = useZoomPan(fullStart, fullEnd, plotW, LABEL_W, chartRef);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [enabledDeps, setEnabledDeps] = useState<Set<DependencyType>>(new Set(DEPENDENCY_TYPES));
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // Un zoom ou un déplacement démonte le span survolé sans émettre pointerleave : on ferme l'infobulle.
  useEffect(() => setHover(null), [view]);
  const [draft, setDraft] = useState<[number, number] | null>(null); // plage en cours de tracé

  // ---- Données dérivées (recalculées seulement si la session ou le repli change) ----
  const allRows = useMemo(() => orderLanes(session.lanes), [session.lanes]);
  const rows = useMemo(() => visibleLaneRows(allRows, collapsed), [allRows, collapsed]);

  const laneData = useMemo(() => {
    const byLane = new Map<string, Span[]>();
    for (const span of session.spans) {
      const list = byLane.get(span.laneId) ?? [];
      list.push(span);
      byLane.set(span.laneId, list);
    }
    const result = new Map<string, LaneData>();
    for (const lane of session.lanes) {
      const spans = sortByStart(byLane.get(lane.id) ?? []);
      result.set(lane.id, { spans, packing: packSpans(spans) });
    }
    return result;
  }, [session]);

  const spanById = useMemo(() => new Map(session.spans.map((s) => [s.id, s])), [session.spans]);

  // Position verticale de chaque lane visible (la hauteur dépend du nombre de sous-lignes).
  const geometry = useMemo(() => {
    let y = 0;
    const items = rows.map((row) => {
      const isCollapsed = collapsed.has(row.lane.id);
      const subRows = laneData.get(row.lane.id)?.packing.rowCount ?? 1;
      const height = isCollapsed
        ? COLLAPSED_H
        : subRows * (SUB_H + SUB_GAP) - SUB_GAP + 2 * LANE_PAD;
      const item = { row, y, height, collapsed: isCollapsed };
      y += height + LANE_GAP;
      return item;
    });
    return { items, totalHeight: Math.max(y, 24) };
  }, [rows, collapsed, laneData]);

  const geometryByLane = useMemo(
    () => new Map(geometry.items.map((g) => [g.row.lane.id, g])),
    [geometry],
  );

  const spanY = useCallback(
    (span: Span): number | null => {
      const g = geometryByLane.get(span.laneId);
      if (!g || g.collapsed) return null; // lane masquée ou repliée : flèche cachée
      const subRow = laneData.get(span.laneId)?.packing.rowOf.get(span.id) ?? 0;
      return g.y + LANE_PAD + subRow * (SUB_H + SUB_GAP) + SUB_H / 2;
    },
    [geometryByLane, laneData],
  );

  const x = scaleLinear().domain([view.t0, view.t1]).range([0, plotW]);
  const ticks = timeTicks(view.t0, view.t1, session.start, Math.floor(plotW / TICK_SPACING_PX));
  const laneOrder = useMemo(() => allRows.map((r) => r.lane.id), [allRows]);

  // ---- Interactions ----
  const onHover = useCallback((span: Span, e: React.PointerEvent) => {
    setHover({ span, x: e.clientX, y: e.clientY });
  }, []);
  const onLeave = useCallback(() => setHover(null), []);
  const onClickSpan = useCallback(
    (span: Span) => {
      if (movedRef.current) return;
      onSelectSpan(span.id === selectedSpanId ? null : span.id);
    },
    [onSelectSpan, selectedSpanId],
  );

  function toggleCollapsed(laneId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId);
      else next.add(laneId);
      return next;
    });
  }

  function toggleDependency(type: DependencyType) {
    setEnabledDeps((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // Pointeur enfoncé sur la zone de tracé : glisser = déplacer la fenêtre,
  // Shift + glisser = tracer une plage de temps.
  function onPlotPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !bodyRef.current) return;
    movedRef.current = false;
    const startView = view; // on fige la vue : pendant le glisser, tout se calcule depuis elle
    const plotLeft = bodyRef.current.getBoundingClientRect().left + LABEL_W;
    const timeAt = (clientX: number) =>
      startView.t0 + ((clientX - plotLeft) / plotW) * (startView.t1 - startView.t0);
    const startX = e.clientX;
    const startT = timeAt(startX);
    let lastT = startT;

    trackDrag(
      (ev) => {
        if (Math.abs(ev.clientX - startX) > MIN_DRAG_PX) {
          movedRef.current = true;
          setHover(null);
        }
        if (!movedRef.current) return;
        if (e.shiftKey) {
          lastT = Math.min(Math.max(timeAt(ev.clientX), fullStart), fullEnd);
          setDraft([startT, lastT]);
        } else {
          const msPerPx = (startView.t1 - startView.t0) / plotW;
          setView(panView(startView, -(ev.clientX - startX) * msPerPx, fullStart, fullEnd));
        }
      },
      () => {
        if (e.shiftKey && movedRef.current) {
          onRangeChange([Math.min(startT, lastT), Math.max(startT, lastT)]);
        }
        setDraft(null);
      },
    );
  }

  const shownRange = draft ?? range;
  const bodyHeight = geometry.totalHeight;

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="tl-legend">
          {CATEGORIES.map((c) => (
            <span key={c} className="tl-legend-item">
              <span className="tl-swatch" style={{ background: CATEGORY_COLORS[c] }} />
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
        <div className="tl-controls">
          {DEPENDENCY_TYPES.map((type) => (
            <label key={type} className="tl-dep-toggle">
              <input
                type="checkbox"
                checked={enabledDeps.has(type)}
                onChange={() => toggleDependency(type)}
              />
              <svg width="22" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="22"
                  y2="4"
                  stroke={DEPENDENCY_STYLES[type].color}
                  strokeWidth="2"
                  strokeDasharray={DEPENDENCY_STYLES[type].dash}
                />
              </svg>
              {DEPENDENCY_STYLES[type].label}
            </label>
          ))}
          <button type="button" onClick={resetView}>
            Tout voir
          </button>
          {range && (
            <button type="button" onClick={() => onRangeChange(null)}>
              Effacer la plage ({formatRelative(range[0] - session.start)} →{" "}
              {formatRelative(range[1] - session.start)}, {formatDuration(range[1] - range[0])})
            </button>
          )}
        </div>
      </div>

      <div className="tl-chart" ref={chartRef}>
        {/* Axe du temps : à part, pour rester visible quand les lanes défilent verticalement */}
        <svg width={width} height={AXIS_H} className="tl-axis">
          <g transform={`translate(${LABEL_W},0)`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(${x(t)},0)`}>
                <line y1={AXIS_H - 6} y2={AXIS_H} className="tl-tick" />
                <text y={AXIS_H - 10} textAnchor="middle" className="tl-tick-label">
                  {formatRelative(t - session.start)}
                </text>
              </g>
            ))}
          </g>
        </svg>

        <div className="tl-body">
          <svg ref={bodyRef} width={width} height={bodyHeight} className="tl-svg">
            <DependencyDefs />
            <defs>
              <clipPath id="tl-plot-clip">
                <rect x={0} y={0} width={plotW} height={bodyHeight} />
              </clipPath>
            </defs>

            {geometry.items.map(({ row, y, height, collapsed: isCollapsed }) => (
              <LaneLabel
                key={row.lane.id}
                row={row}
                y={y}
                height={height}
                width={LABEL_W}
                collapsed={isCollapsed}
                selected={row.lane.id === selectedLaneId}
                onToggle={() => toggleCollapsed(row.lane.id)}
                onSelect={() => onSelectLane(row.lane.id === selectedLaneId ? null : row.lane.id)}
              />
            ))}

            <g transform={`translate(${LABEL_W},0)`} onPointerDown={onPlotPointerDown}>
              {/* Fond : reçoit le glisser et le double-clic (efface la plage) */}
              <rect
                className="tl-plot-bg"
                width={plotW}
                height={bodyHeight}
                onDoubleClick={() => onRangeChange(null)}
              />
              {geometry.items.map(({ row, y, height }) => (
                <rect
                  key={row.lane.id}
                  className={row.lane.id === selectedLaneId ? "tl-lane-bg selected" : "tl-lane-bg"}
                  y={y}
                  width={plotW}
                  height={height}
                />
              ))}
              {ticks.map((t) => (
                <line key={t} className="tl-grid" x1={x(t)} x2={x(t)} y1={0} y2={bodyHeight} />
              ))}

              <g clipPath="url(#tl-plot-clip)">
                {shownRange && (
                  <rect
                    className={draft ? "tl-range draft" : "tl-range"}
                    x={x(shownRange[0])}
                    y={0}
                    width={Math.max(1, x(shownRange[1]) - x(shownRange[0]))}
                    height={bodyHeight}
                  />
                )}
                {geometry.items.map(({ row, y, collapsed: isCollapsed }) => {
                  const data = laneData.get(row.lane.id);
                  if (!data) return null;
                  return (
                    <LaneSpans
                      key={row.lane.id}
                      spans={data.spans}
                      rowOf={data.packing.rowOf}
                      y={y}
                      collapsed={isCollapsed}
                      dimmed={selectedLaneId !== null && row.lane.id !== selectedLaneId}
                      t0={view.t0}
                      t1={view.t1}
                      plotWidth={plotW}
                      selectedSpanId={selectedSpanId}
                      onHover={onHover}
                      onLeave={onLeave}
                      onClickSpan={onClickSpan}
                    />
                  );
                })}
                <Dependencies
                  dependencies={session.dependencies}
                  spanById={spanById}
                  enabled={enabledDeps}
                  spanY={spanY}
                  t0={view.t0}
                  t1={view.t1}
                  plotWidth={plotW}
                />
              </g>
            </g>
          </svg>
        </div>
      </div>

      <div className="tl-minimap-wrap" style={{ marginLeft: LABEL_W }}>
        <Minimap
          session={session}
          laneOrder={laneOrder}
          view={view}
          range={shownRange}
          width={plotW}
          onViewChange={setView}
        />
      </div>
      <div className="tl-hint">
        Molette : zoom · Glisser : déplacer · Maj + glisser : choisir une plage · Double-clic sur le fond : effacer la plage
      </div>

      {hover && <Tooltip hover={hover} />}
    </div>
  );
}
