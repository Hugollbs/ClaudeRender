import { describe, expect, it } from "vitest";
import type { Lane, Span } from "../src/shared/types";
import { spanCategory } from "../src/client/timeline/colors";
import {
  clampView,
  formatRelative,
  orderLanes,
  packSpans,
  thinkingTitle,
  timeTicks,
  visibleLaneRows,
  groupMinimapSpans,
  visibleSpans,
  zoomView,
} from "../src/client/timeline/layout";
import { generateBigMockSession, mockSession } from "../src/client/devMock";

function span(id: string, start: number, end: number, extra: Partial<Span> = {}): Span {
  return { id, laneId: "main", type: "tool", tool: "Read", start, end, status: "ok", summary: "", ...extra };
}

describe("spanCategory", () => {
  it("classe les outils connus", () => {
    expect(spanCategory({ type: "tool", tool: "Grep" })).toBe("read");
    expect(spanCategory({ type: "tool", tool: "Write" })).toBe("edit");
    expect(spanCategory({ type: "tool", tool: "Monitor" })).toBe("bash");
    expect(spanCategory({ type: "tool", tool: "WebFetch" })).toBe("web");
  });
  it("le type prime sur l'outil", () => {
    expect(spanCategory({ type: "thinking" })).toBe("thinking");
    expect(spanCategory({ type: "text" })).toBe("text");
    expect(spanCategory({ type: "subagent", tool: "Task" })).toBe("subagent");
  });
  it("met mcp__* et outils inconnus (ou absents) dans autre", () => {
    expect(spanCategory({ type: "tool", tool: "mcp__x__y" })).toBe("other");
    expect(spanCategory({ type: "tool" })).toBe("other");
  });
});

describe("visibleSpans", () => {
  const spans = [
    span("avant", 0, 100),
    span("dedans", 500, 900),
    span("chevauche", 950, 1200),
    span("apres", 2000, 2500),
  ];
  it("garde ceux qui intersectent la fenêtre", () => {
    const ids = visibleSpans(spans, 400, 1000, 1).map((s) => s.id);
    expect(ids).toEqual(["dedans", "chevauche"]);
  });
  it("masque les spans plus petits que 0,5 px mais garde les erreurs", () => {
    const tiny = [span("petit", 100, 101), span("erreur", 200, 201, { status: "error" })];
    // 10 ms par pixel : 1 ms = 0,1 px
    expect(visibleSpans(tiny, 0, 1000, 10).map((s) => s.id)).toEqual(["erreur"]);
  });
  it("durcit le seuil à 1 px quand il y a trop de spans", () => {
    // 0,7 px de large : gardé en temps normal, masqué quand la fenêtre est saturée
    const normal = [span("a", 0, 7)];
    expect(visibleSpans(normal, 0, 1000, 10)).toHaveLength(1);
    const crowded = Array.from({ length: 1600 }, (_, i) => span(`s${i}`, i * 10, i * 10 + 7));
    expect(visibleSpans(crowded, 0, 20000, 10)).toHaveLength(0);
  });
  it("reste rapide sur 5000 spans", () => {
    const big = generateBigMockSession(5000);
    const sorted = big.spans.filter((s) => s.laneId === "main").sort((a, b) => a.start - b.start);
    const started = performance.now();
    visibleSpans(sorted, big.start, big.end, 1000);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("orderLanes / visibleLaneRows", () => {
  const lanes: Lane[] = [
    { id: "b", name: "B (enfant de a)", type: "subagent", parentLaneId: "a" },
    { id: "a", name: "A", type: "subagent", parentLaneId: "main" },
    { id: "main", name: "Principal", type: "main" },
    { id: "c", name: "C", type: "subagent", parentLaneId: "main" },
  ];
  it("main d'abord, enfants sous leur parent avec la bonne profondeur", () => {
    const rows = orderLanes(lanes);
    expect(rows.map((r) => [r.lane.id, r.depth])).toEqual([
      ["main", 0],
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[2].hasChildren).toBe(false);
  });
  it("traite une lane au parent inconnu comme une racine, sans boucler sur un cycle", () => {
    const odd: Lane[] = [
      { id: "x", name: "X", type: "subagent", parentLaneId: "y" },
      { id: "y", name: "Y", type: "subagent", parentLaneId: "x" },
      { id: "z", name: "Z", type: "subagent", parentLaneId: "absent" },
    ];
    expect(orderLanes(odd).map((r) => r.lane.id)).toEqual(["z"]);
  });
  it("replier une lane masque ses descendantes mais pas ses sœurs", () => {
    const rows = orderLanes(lanes);
    const ids = visibleLaneRows(rows, new Set(["a"])).map((r) => r.lane.id);
    expect(ids).toEqual(["main", "a", "c"]);
  });
});

describe("packSpans", () => {
  it("met les spans qui se chevauchent sur des sous-lignes différentes", () => {
    const { rowOf, rowCount } = packSpans([span("a", 0, 100), span("b", 50, 150), span("c", 100, 200)]);
    expect(rowCount).toBe(2);
    expect(rowOf.get("a")).toBe(0);
    expect(rowOf.get("b")).toBe(1);
    expect(rowOf.get("c")).toBe(0); // a se termine à 100 : la ligne 0 est libre
  });
  it("retourne 1 ligne pour une lane vide", () => {
    expect(packSpans([]).rowCount).toBe(1);
  });
});

describe("zoom, axe et formats", () => {
  it("zoomView garde le temps sous le curseur et reste dans la session", () => {
    const view = zoomView({ t0: 0, t1: 1000 }, 0.5, 0.5, 0, 1000);
    expect(view).toEqual({ t0: 250, t1: 750 });
    const out = zoomView({ t0: 0, t1: 1000 }, 0.5, 10, 0, 1000);
    expect(out).toEqual({ t0: 0, t1: 1000 });
  });
  it("clampView décale une fenêtre qui dépasse", () => {
    expect(clampView({ t0: 900, t1: 1100 }, 0, 1000)).toEqual({ t0: 800, t1: 1000 });
  });
  it("formatRelative", () => {
    expect(formatRelative(250)).toBe("+250ms");
    expect(formatRelative(12_000)).toBe("+12s");
    expect(formatRelative(80_000)).toBe("+1m20s");
    expect(formatRelative(120_000)).toBe("+2m");
    expect(formatRelative(3_720_000)).toBe("+1h02m");
  });
  it("timeTicks aligne les graduations sur le début de session", () => {
    const ticks = timeTicks(1000, 61_000, 1000, 6);
    expect(ticks[0]).toBe(1000);
    expect((ticks[1] - ticks[0]) % 10_000).toBe(0);
    expect(ticks.length).toBeLessThanOrEqual(10);
  });
  it("thinkingTitle prend la première phrase, tronquée", () => {
    expect(thinkingTitle("Je lis le fichier. Puis je modifie.")).toBe("Je lis le fichier.");
    expect(thinkingTitle("x".repeat(100)).length).toBe(60);
  });
});

describe("devMock", () => {
  it("génère une session cohérente : ids uniques, dépendances valides", () => {
    for (const session of [mockSession, generateBigMockSession(5000)]) {
      const ids = new Set(session.spans.map((s) => s.id));
      expect(ids.size).toBe(session.spans.length);
      for (const d of session.dependencies) {
        expect(ids.has(d.fromSpanId)).toBe(true);
        expect(ids.has(d.toSpanId)).toBe(true);
      }
    }
    expect(mockSession.spans.length).toBeGreaterThanOrEqual(290);
    expect(generateBigMockSession(5000).spans.length).toBeGreaterThanOrEqual(5000);
  });
});

describe("groupMinimapSpans", () => {
  const bandOf = new Map([["main", 0]]);
  const group = (spans: Span[], width = 100) =>
    groupMinimapSpans(spans, bandOf, 1, 0, 1000, width, () => "bleu", "rouge");
  it("fusionne des milliers de spans plus petits qu'un pixel en peu de blocs", () => {
    const tiny = Array.from({ length: 5000 }, (_, i) => span(`s${i}`, i * 0.2, i * 0.2 + 0.1));
    const blocks = group(tiny);
    expect(blocks).toHaveLength(1); // colonnes contiguës de même couleur
    expect(blocks[0]).toMatchObject({ x0: 0, x1: 100 });
  });
  it("laisse un trou entre deux zones séparées", () => {
    const blocks = group([span("a", 0, 50), span("b", 800, 850)]);
    expect(blocks).toHaveLength(2);
  });
  it("une erreur colore sa colonne même au milieu d'autres spans", () => {
    const blocks = group([span("a", 0, 100), span("e", 40, 41, { status: "error" })]);
    expect(blocks.some((b) => b.color === "rouge")).toBe(true);
  });
  it("accepte une session vide et une durée nulle", () => {
    expect(group([])).toEqual([]);
    expect(groupMinimapSpans([span("a", 5, 5)], bandOf, 1, 5, 5, 100, () => "bleu", "rouge")).toHaveLength(1);
  });
});
