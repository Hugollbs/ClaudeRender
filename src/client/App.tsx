import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetricsFilter, Pricing, Session, SessionSummary } from "../shared/types";
import pricingExample from "../../config/pricing.json";
import { fetchPricing, fetchSession, fetchSessions } from "./api";
import { mockSession } from "./devMock";
import { SessionPicker } from "./SessionPicker";
import { SpanDetail } from "./SpanDetail";
import { MetricsPanel } from "./MetricsPanel";
import { Timeline } from "./timeline/Timeline";

type Tab = "detail" | "metrics";

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [laneId, setLaneId] = useState<string | null>(null);
  const [spanId, setSpanId] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [tab, setTab] = useState<Tab>("detail");

  // Chargement initial : liste des sessions + tarifs, puis la plus récente (le serveur trie déjà).
  useEffect(() => {
    let cancelled = false; // évite de mettre à jour l'état si le composant est démonté
    Promise.all([fetchSessions(), fetchPricing()])
      .then(([list, prices]) => {
        if (cancelled) return;
        setSessions(list);
        setPricing(prices);
        if (list.length > 0) setSelectedId(list[0].id);
        else setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Chargement de la session choisie ; changer de session réinitialise sélection et plage.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLaneId(null);
    setSpanId(null);
    setRange(null);
    fetchSession(selectedId)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const useDemo = useCallback(() => {
    setError(null);
    setSessions([]);
    setSelectedId(null);
    setPricing(pricingExample as Pricing);
    setSession(mockSession);
    setLoading(false);
  }, []);

  const selectSpan = useCallback((id: string | null) => {
    setSpanId(id);
    if (id) setTab("detail");
  }, []);

  // Objet stable : MetricsPanel le met en dépendance de son useMemo.
  const filter = useMemo<MetricsFilter>(
    () => ({
      laneId: laneId ?? undefined,
      from: range?.[0],
      to: range?.[1],
    }),
    [laneId, range],
  );

  const selectedSpan = session?.spans.find((s) => s.id === spanId) ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Claude Render</h1>
        {sessions.length > 0 && (
          <SessionPicker sessions={sessions} value={selectedId} onChange={setSelectedId} />
        )}
      </header>

      {loading && <div className="notice">Chargement…</div>}

      {!loading && error && (
        <div className="notice error" role="alert">
          <strong>Impossible de charger les données</strong>
          <p>{error}</p>
          <div className="actions">
            <button type="button" onClick={useDemo}>Données de démo</button>
          </div>
        </div>
      )}

      {!loading && !error && !session && (
        <div className="notice">
          Aucune session trouvée.
          <div className="actions">
            <button type="button" onClick={useDemo}>Données de démo</button>
          </div>
        </div>
      )}

      {!loading && !error && session && pricing && (
        <main className="app-main">
          <div className="timeline-area">
            <Timeline
              session={session}
              selectedLaneId={laneId}
              onSelectLane={setLaneId}
              selectedSpanId={spanId}
              onSelectSpan={selectSpan}
              range={range}
              onRangeChange={setRange}
            />
          </div>
          <aside className="side-panel">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "detail"} onClick={() => setTab("detail")}>
                Détail
              </button>
              <button type="button" role="tab" aria-selected={tab === "metrics"} onClick={() => setTab("metrics")}>
                Métriques
              </button>
            </div>
            <div className="side-body">
              {tab === "detail" ? (
                selectedSpan ? (
                  <SpanDetail span={selectedSpan} session={session} onDeselect={() => setSpanId(null)} />
                ) : (
                  <p className="muted">Sélectionne un span dans la timeline pour voir son détail.</p>
                )
              ) : (
                <MetricsPanel
                  session={session}
                  pricing={pricing}
                  filter={filter}
                  onSelectSpan={selectSpan}
                  onClearLane={() => setLaneId(null)}
                  onClearRange={() => setRange(null)}
                />
              )}
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}
