import { useMemo } from "react";
import type { MetricsFilter, Pricing, Session } from "../shared/types";
import { computeMetrics } from "../shared/metrics";
import { CATEGORY_COLORS, spanCategory } from "./timeline/colors";
import { formatClock, formatCost, formatDuration, formatPercent, formatTokens } from "./format";
import { formatRelative } from "./timeline/layout";

interface Props {
  session: Session;
  pricing: Pricing;
  filter: MetricsFilter;
  onSelectSpan: (id: string) => void;
  onClearLane: () => void;
  onClearRange: () => void;
}

const MAX_BARS = 10;
const LANE_COLOR = "#7d7fa8";

interface Bar {
  key: string;
  label: string;
  value: number; // sert à la largeur
  text: string; // texte affiché à droite
  color: string;
}

// Barres horizontales en HTML/CSS : largeur proportionnelle au max de la liste.
function BarList({ bars }: { bars: Bar[] }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <ul className="bars">
      {bars.slice(0, MAX_BARS).map((b) => (
        <li key={b.key}>
          <div className="bar-label">
            <span className="bar-name" title={b.label}>{b.label}</span>
            <span className="bar-text">{b.text}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(b.value / max) * 100}%`, background: b.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MetricsPanel({ session, pricing, filter, onSelectSpan, onClearLane, onClearRange }: Props) {
  // computeMetrics parcourt tous les spans : on ne le refait que si une entrée change.
  const m = useMemo(() => computeMetrics(session, filter, pricing), [session, filter, pricing]);

  const laneName = session.lanes.find((l) => l.id === filter.laneId)?.name ?? filter.laneId;
  const hasRange = filter.from !== undefined && filter.to !== undefined;
  const measured = m.thinkingMs + m.actingMs;

  const toolBars: Bar[] = m.byTool.map((t) => ({
    key: t.tool,
    label: t.tool,
    value: t.totalMs,
    text: `${formatDuration(t.totalMs)} · ${t.count} appel${t.count > 1 ? "s" : ""}`,
    color: CATEGORY_COLORS[spanCategory({ type: "tool", tool: t.tool })],
  }));
  const laneBars: Bar[] = [...m.byLane]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((l) => ({
      key: l.laneId,
      label: l.name,
      value: l.totalMs,
      text: `${formatDuration(l.totalMs)} · ${l.toolCalls} outil${l.toolCalls > 1 ? "s" : ""}`,
      color: LANE_COLOR,
    }));

  return (
    <div className="metrics">
      <h2>Métriques</h2>

      <div className="chips">
        {filter.laneId !== undefined && (
          <span className="chip">
            Agent : {laneName}
            <button type="button" onClick={onClearLane} aria-label="Retirer le filtre agent">×</button>
          </span>
        )}
        {hasRange && (
          <span className="chip">
            Plage : {formatRelative(filter.from! - session.start)} → {formatRelative(filter.to! - session.start)}
            <button type="button" onClick={onClearRange} aria-label="Retirer la plage">×</button>
          </span>
        )}
        {filter.laneId === undefined && !hasRange && <span className="muted">Aucun filtre (session entière)</span>}
      </div>

      <section>
        <h3>Totaux</h3>
        <dl className="kv">
          <dt>Durée</dt><dd>{formatDuration(m.durationMs)}</dd>
          <dt>Tokens entrée</dt><dd>{formatTokens(m.tokens.input)}</dd>
          <dt>Tokens sortie</dt><dd>{formatTokens(m.tokens.output)}</dd>
          <dt>Cache lecture</dt><dd>{formatTokens(m.tokens.cacheRead)}</dd>
          <dt>Cache création</dt><dd>{formatTokens(m.tokens.cacheCreation)}</dd>
          <dt>Coût estimé</dt><dd>{formatCost(m.costUsd)}</dd>
          <dt>Appels d'outils</dt><dd>{formatTokens(m.toolCalls)}</dd>
        </dl>
        <p className="muted small">Estimation d'après config/pricing.json (valeurs d'exemple à vérifier).</p>
      </section>

      <section>
        <h3>Par outil</h3>
        {toolBars.length === 0 ? <p className="muted">Aucun outil utilisé</p> : <BarList bars={toolBars} />}
      </section>

      <section>
        <h3>Par agent</h3>
        {laneBars.length === 0 ? <p className="muted">Aucune activité</p> : <BarList bars={laneBars} />}
      </section>

      <section>
        <h3>Réflexion vs action</h3>
        {measured === 0 ? (
          <p className="muted">Aucun temps mesuré</p>
        ) : (
          <>
            <div className="stack">
              <div style={{ width: `${(m.thinkingMs / measured) * 100}%`, background: CATEGORY_COLORS.thinking }} />
              <div style={{ width: `${(m.actingMs / measured) * 100}%`, background: CATEGORY_COLORS.bash }} />
            </div>
            <p className="small">
              Réflexion {formatDuration(m.thinkingMs)} ({formatPercent(m.thinkingMs, measured)}) · Action{" "}
              {formatDuration(m.actingMs)} ({formatPercent(m.actingMs, measured)})
            </p>
          </>
        )}
        <p className="muted small">Pourcentages sur le temps mesuré ; le reste = attente/texte non mesuré.</p>
      </section>

      <section>
        <h3>Erreurs ({m.errors.length})</h3>
        {m.errors.length === 0 ? (
          <p className="muted">Aucune erreur</p>
        ) : (
          <ul className="links">
            {m.errors.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onSelectSpan(s.id)}>
                  <strong>{s.tool ?? s.type}</strong> {s.summary}
                  <span className="muted"> · {formatClock(s.start - session.start)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Appels répétés ({m.repeated.length})</h3>
        {m.repeated.length === 0 ? (
          <p className="muted">Aucun appel répété</p>
        ) : (
          <ul className="links">
            {m.repeated.map((r) => (
              <li key={r.spanIds[0]}>
                <button type="button" onClick={() => onSelectSpan(r.spanIds[0])}>
                  <strong>{r.tool}</strong> ×{r.count} <code>{r.inputKey}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
