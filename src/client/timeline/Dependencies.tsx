import type { Dependency, DependencyType, Span } from "../../shared/types";
import { DEPENDENCY_STYLES, DEPENDENCY_TYPES } from "./colors";

// Limite de sécurité : au-delà, on ne dessine pas plus de flèches (lisibilité et performance).
const MAX_ARROWS = 600;

interface Props {
  dependencies: Dependency[];
  spanById: Map<string, Span>;
  enabled: Set<DependencyType>;
  // y du centre d'un span, ou null si sa lane est repliée / masquée (la flèche est alors cachée)
  spanY: (span: Span) => number | null;
  t0: number;
  t1: number;
  plotWidth: number;
}

// Définition des pointes de flèche (une par type, pour avoir la bonne couleur).
export function DependencyDefs() {
  return (
    <defs>
      {DEPENDENCY_TYPES.map((type) => (
        <marker
          key={type}
          id={`tl-arrow-${type}`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" fill={DEPENDENCY_STYLES[type].color} />
        </marker>
      ))}
    </defs>
  );
}

export function Dependencies({ dependencies, spanById, enabled, spanY, t0, t1, plotWidth }: Props) {
  const toX = (t: number) => ((t - t0) / (t1 - t0)) * plotWidth;
  const inWindow = (s: Span) => s.end >= t0 && s.start <= t1;
  const arrows: React.ReactNode[] = [];

  for (let i = 0; i < dependencies.length && arrows.length < MAX_ARROWS; i++) {
    const dep = dependencies[i];
    if (!enabled.has(dep.type)) continue;
    const from = spanById.get(dep.fromSpanId);
    const to = spanById.get(dep.toSpanId);
    if (!from || !to) continue;
    if (!inWindow(from) && !inWindow(to)) continue; // aucune extrémité visible
    const y1 = spanY(from);
    const y2 = spanY(to);
    if (y1 === null || y2 === null) continue;

    // "spawn" part du début du span parent (le sous-agent démarre à ce moment-là).
    // Pour les autres, on part de la fin ; si la cible est antérieure (ex. résultat qui
    // revient sur le span "subagent" du parent), on la rejoint par sa fin pour garder une flèche vers l'avant.
    const x1 = toX(dep.type === "spawn" ? from.start : from.end);
    const x2 = toX(to.start >= from.end || dep.type === "spawn" ? to.start : to.end);
    const dx = Math.max(20, Math.abs(x2 - x1) / 2);
    const style = DEPENDENCY_STYLES[dep.type];
    arrows.push(
      <path
        key={i}
        d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
        fill="none"
        stroke={style.color}
        strokeWidth={1.3}
        strokeDasharray={style.dash}
        opacity={0.85}
        markerEnd={`url(#tl-arrow-${dep.type})`}
        pointerEvents="none"
      />,
    );
  }
  return <g>{arrows}</g>;
}
