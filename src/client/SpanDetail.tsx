import type { Lane, Session, Span } from "../shared/types";
import { formatClock, formatDuration, formatTokens } from "./format";

interface Props {
  span: Span;
  session: Session;
  onDeselect: () => void;
}

const MAX_JSON_CHARS = 2000;
const MAX_TITLE_CHARS = 60;

// Titre court = première phrase, tronquée.
function shortTitle(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return firstSentence.length > MAX_TITLE_CHARS
    ? firstSentence.slice(0, MAX_TITLE_CHARS - 1) + "…"
    : firstSentence;
}

// JSON.stringify peut échouer (référence circulaire) : on retombe sur String().
function prettyInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    text = String(input);
  }
  return text.length > MAX_JSON_CHARS
    ? text.slice(0, MAX_JSON_CHARS) + `\n… (tronqué, ${text.length} caractères au total)`
    : text;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function SpanDetail({ span, session, onDeselect }: Props) {
  const lane: Lane | undefined = session.lanes.find((l) => l.id === span.laneId);
  const t = span.tokens;

  return (
    <div className="span-detail">
      <div className="panel-row">
        <h2>Détail du span</h2>
        <button type="button" onClick={onDeselect}>
          Désélectionner
        </button>
      </div>

      <dl className="kv">
        <Row label="Type">{span.type}</Row>
        {span.tool && <Row label="Outil">{span.tool}</Row>}
        <Row label="Lane">{lane?.name ?? span.laneId}</Row>
        <Row label="Début">{formatClock(span.start - session.start)}</Row>
        <Row label="Fin">{formatClock(span.end - session.start)}</Row>
        <Row label="Durée">{formatDuration(span.end - span.start)}</Row>
        <Row label="Statut">
          <span className={`status status-${span.status}`}>{span.status}</span>
        </Row>
        {span.model && <Row label="Modèle">{span.model}</Row>}
        {span.filePath && <Row label="Fichier"><code>{span.filePath}</code></Row>}
      </dl>

      {t && (
        <>
          <h3>Tokens</h3>
          <dl className="kv">
            <Row label="Entrée">{formatTokens(t.input)}</Row>
            <Row label="Sortie">{formatTokens(t.output)}</Row>
            <Row label="Cache lecture">{formatTokens(t.cacheRead)}</Row>
            <Row label="Cache création">{formatTokens(t.cacheCreation)}</Row>
            <Row label="Réflexion">{formatTokens(t.thinking)}</Row>
          </dl>
        </>
      )}

      <h3>Résumé</h3>
      <p className="summary">{span.summary || "(vide)"}</p>

      {span.type === "thinking" && (
        <details className="card">
          <summary>{span.thinkingContent ? shortTitle(span.thinkingContent) : "Réflexion"}</summary>
          {span.thinkingContent ? (
            <p className="pre-wrap">{span.thinkingContent}</p>
          ) : (
            <p className="muted">
              Contenu de la réflexion non disponible dans le transcript (seule la durée est enregistrée)
            </p>
          )}
        </details>
      )}

      {span.input !== undefined && (
        <>
          <h3>Arguments</h3>
          <pre className="code">{prettyInput(span.input)}</pre>
        </>
      )}

      {span.detail && (
        <>
          <h3>Extrait du résultat</h3>
          <pre className="code">{span.detail}</pre>
        </>
      )}
    </div>
  );
}
