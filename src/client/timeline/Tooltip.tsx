import type { Span } from "../../shared/types";
import { CATEGORY_LABELS, spanCategory } from "./colors";
import { formatDuration, thinkingTitle, truncate } from "./layout";

export interface HoverInfo {
  span: Span;
  x: number; // position écran (clientX / clientY) du pointeur
  y: number;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT_GUESS = 160;

export function Tooltip({ hover }: { hover: HoverInfo }) {
  const { span } = hover;
  // On garde l'infobulle dans la fenêtre : à gauche / au-dessus du curseur près des bords.
  const left = Math.min(hover.x + 14, window.innerWidth - TOOLTIP_WIDTH - 8);
  const top =
    hover.y + 18 + TOOLTIP_HEIGHT_GUESS > window.innerHeight
      ? hover.y - TOOLTIP_HEIGHT_GUESS
      : hover.y + 18;
  const text = span.summary || span.detail || "";

  return (
    <div className="tl-tooltip" style={{ left, top, width: TOOLTIP_WIDTH }}>
      <div className="tl-tooltip-title">
        {span.tool ?? CATEGORY_LABELS[spanCategory(span)]}
        {/* Sans outil (réflexion, texte), le titre est déjà la catégorie : pas de répétition. */}
        {span.tool && <span className="tl-tooltip-cat"> · {CATEGORY_LABELS[spanCategory(span)]}</span>}
        {span.status !== "ok" && <span className={`tl-badge tl-badge-${span.status}`}>{span.status}</span>}
      </div>
      <div>Durée : {formatDuration(span.end - span.start)}</div>
      {span.tokens && (
        <div>
          Tokens : {span.tokens.input} in / {span.tokens.output} out
          {span.tokens.thinking > 0 && ` (dont ${span.tokens.thinking} réflexion)`}
          {span.tokens.cacheRead > 0 && ` · cache lu ${span.tokens.cacheRead}`}
        </div>
      )}
      {span.type === "thinking" &&
        (span.thinkingContent ? (
          <div className="tl-tooltip-text">« {thinkingTitle(span.thinkingContent)} »</div>
        ) : (
          <div className="tl-tooltip-muted">Contenu non disponible dans le transcript</div>
        ))}
      {span.type !== "thinking" && text && (
        <div className="tl-tooltip-text">{truncate(text, 200)}</div>
      )}
      {span.type !== "thinking" && span.detail && span.detail !== text && (
        <div className="tl-tooltip-muted">{truncate(span.detail, 160)}</div>
      )}
    </div>
  );
}
