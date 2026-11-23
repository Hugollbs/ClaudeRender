import { memo, useMemo } from "react";
import { scaleLinear } from "d3-scale";
import type { Session } from "../../shared/types";
import { CATEGORY_COLORS, spanCategory } from "./colors";
import { groupMinimapSpans, panView, type View } from "./layout";
import { trackDrag } from "./useZoomPan";

export const MINIMAP_H = 44;
const ERROR_COLOR = "#ff5c5c";

interface Props {
  session: Session;
  laneOrder: string[]; // ids des lanes, dans l'ordre d'affichage
  view: View;
  range: [number, number] | null;
  width: number; // largeur de la zone de tracé
  onViewChange: (view: View) => void;
}

// Fond de la minimap : toute la session, une bande par lane. Mémoïsé car les blocs
// ne doivent pas être recréés quand seul le rectangle de fenêtre bouge.
const MinimapSpans = memo(function MinimapSpans(p: {
  session: Session;
  laneOrder: string[];
  width: number;
}) {
  const { session, laneOrder, width } = p;
  const rects = useMemo(() => {
    const bandH = (MINIMAP_H - 4) / Math.max(1, laneOrder.length);
    const bandOf = new Map(laneOrder.map((id, i) => [id, i]));
    const blocks = groupMinimapSpans(
      session.spans,
      bandOf,
      Math.max(1, laneOrder.length),
      session.start,
      Math.max(session.end, session.start + 1),
      width,
      (s) => CATEGORY_COLORS[spanCategory(s)],
      ERROR_COLOR,
    );
    return blocks.map((b) => (
      <rect
        key={`${b.band}:${b.x0}`}
        x={b.x0}
        y={2 + b.band * bandH}
        width={b.x1 - b.x0}
        height={Math.max(1.5, bandH - 1)}
        fill={b.color}
        opacity={0.8}
      />
    ));
  }, [session, laneOrder, width]);
  return <g>{rects}</g>;
});

export function Minimap({ session, laneOrder, view, range, width, onViewChange }: Props) {
  const full0 = session.start;
  const full1 = Math.max(session.end, session.start + 1);
  const x = scaleLinear().domain([full0, full1]).range([0, width]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const svgLeft = e.currentTarget.getBoundingClientRect().left;
    const timeAt = (clientX: number) => x.invert(clientX - svgLeft);
    const t = timeAt(e.clientX);
    const inside = t >= view.t0 && t <= view.t1;
    // Clic dans le rectangle : on le saisit là où on a cliqué ; en dehors : on le centre sur le clic.
    const grab = inside ? t - view.t0 : (view.t1 - view.t0) / 2;
    const move = (clientX: number) => {
      const newT0 = timeAt(clientX) - grab;
      onViewChange(panView(view, newT0 - view.t0, full0, full1));
    };
    move(e.clientX);
    trackDrag((ev) => move(ev.clientX), () => {});
  }

  return (
    <svg className="tl-minimap" width={width} height={MINIMAP_H} onPointerDown={onPointerDown}>
      <MinimapSpans session={session} laneOrder={laneOrder} width={width} />
      {range && (
        <rect
          x={x(range[0])}
          y={0}
          width={Math.max(1, x(range[1]) - x(range[0]))}
          height={MINIMAP_H}
          className="tl-range"
        />
      )}
      <rect
        x={x(view.t0)}
        y={0.5}
        width={Math.max(3, x(view.t1) - x(view.t0))}
        height={MINIMAP_H - 1}
        className="tl-viewport"
      />
    </svg>
  );
}
