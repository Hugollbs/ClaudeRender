import { describe, expect, it } from "vitest";
import { computeMetrics } from "../src/shared/metrics";
import type { Pricing, Session, Span, TokenUsage } from "../src/shared/types";

const pricing: Pricing = {
  default: { input: 1, output: 2, cacheRead: 0.1, cacheCreation: 1.5 },
  models: {
    "claude-opus": { input: 10, output: 20, cacheRead: 1, cacheCreation: 15 },
    "claude-opus-4": { input: 100, output: 200, cacheRead: 10, cacheCreation: 150 },
  },
};

function tokens(input: number, output: number): TokenUsage {
  return { input, output, cacheRead: 0, cacheCreation: 0, thinking: 0 };
}

function span(p: Partial<Span> & Pick<Span, "id" | "start" | "end">): Span {
  return { laneId: "main", type: "tool", status: "ok", summary: "", ...p };
}

// main (0..1000), sub1 fille de main, sub2 fille de sub1, other indépendante.
function buildSession(spans: Span[]): Session {
  return {
    id: "s",
    project: "p",
    start: 0,
    end: 1000,
    lanes: [
      { id: "main", name: "Agent principal", type: "main" },
      { id: "sub1", name: "Sous-agent 1", type: "subagent", parentLaneId: "main" },
      { id: "sub2", name: "Sous-agent 2", type: "subagent", parentLaneId: "sub1" },
      { id: "other", name: "Autre", type: "subagent", parentLaneId: "main" },
    ],
    spans,
    dependencies: [],
  };
}

describe("computeMetrics", () => {
  it("session vide : tout à zéro", () => {
    const m = computeMetrics(buildSession([]), {}, pricing);
    expect(m.durationMs).toBe(0);
    expect(m.toolCalls).toBe(0);
    expect(m.costUsd).toBe(0);
    expect(m.byTool).toEqual([]);
    expect(m.byLane).toEqual([]);
    expect(m.repeated).toEqual([]);
  });

  it("calcule durée, outils, réflexion et erreurs", () => {
    const spans = [
      span({ id: "t1", tool: "Bash", start: 100, end: 300 }),
      span({ id: "t2", tool: "Read", start: 300, end: 400, status: "error" }),
      span({ id: "th", type: "thinking", start: 400, end: 700 }),
      span({ id: "ag", type: "subagent", tool: "Agent", start: 100, end: 900 }),
    ];
    const m = computeMetrics(buildSession(spans), {}, pricing);
    expect(m.durationMs).toBe(800); // 900 - 100
    expect(m.toolCalls).toBe(2); // le subagent n'est pas un appel d'outil
    expect(m.actingMs).toBe(300);
    expect(m.thinkingMs).toBe(300);
    expect(m.errors.map((s) => s.id)).toEqual(["t2"]);
    expect(m.byTool[0]).toEqual({ tool: "Agent", count: 1, totalMs: 800, errors: 0 });
    expect(m.byTool.find((t) => t.tool === "Read")?.errors).toBe(1);
  });

  it("filtre par lane : inclut les descendantes, exclut les autres", () => {
    const spans = [
      span({ id: "a", laneId: "main", tool: "Bash", start: 0, end: 10 }),
      span({ id: "b", laneId: "sub1", tool: "Bash", start: 0, end: 10 }),
      span({ id: "c", laneId: "sub2", tool: "Bash", start: 0, end: 10 }),
      span({ id: "d", laneId: "other", tool: "Bash", start: 0, end: 10 }),
    ];
    const m = computeMetrics(buildSession(spans), { laneId: "sub1" }, pricing);
    expect(m.toolCalls).toBe(2);
    expect(m.byLane.map((l) => l.laneId).sort()).toEqual(["sub1", "sub2"]);
    expect(m.byLane.find((l) => l.laneId === "sub1")?.name).toBe("Sous-agent 1");
  });

  it("plage de temps : garde les spans qui chevauchent et clippe le temps", () => {
    const spans = [
      span({ id: "avant", tool: "Bash", start: 0, end: 90 }),
      span({ id: "dedans", tool: "Bash", start: 150, end: 180 }),
      span({ id: "deborde", tool: "Read", start: 180, end: 300 }),
      span({ id: "apres", tool: "Bash", start: 400, end: 500 }),
    ];
    const m = computeMetrics(buildSession(spans), { from: 100, to: 200 }, pricing);
    expect(m.durationMs).toBe(100);
    expect(m.toolCalls).toBe(2);
    expect(m.actingMs).toBe(30 + 20); // 150-180 entier, 180-200 clippé
    expect(m.byTool.find((t) => t.tool === "Read")?.totalMs).toBe(20);
  });

  it("tokens dédoublonnés : un seul span porte les tokens, coût au prix du préfixe le plus long", () => {
    const spans = [
      span({ id: "x", tool: "Bash", start: 0, end: 10, tokens: tokens(1_000_000, 500_000), model: "claude-opus-4-1" }),
      span({ id: "y", tool: "Read", start: 10, end: 20 }), // même requête, pas de tokens
    ];
    const m = computeMetrics(buildSession(spans), {}, pricing);
    expect(m.tokens.input).toBe(1_000_000);
    expect(m.tokens.output).toBe(500_000);
    // préfixe "claude-opus-4" (100/200) : 1M*100 + 0.5M*200 = 200 $
    expect(m.costUsd).toBeCloseTo(200);
    expect(m.byLane[0].costUsd).toBeCloseTo(200);
  });

  it("modèle inconnu ou absent : prix par défaut", () => {
    const spans = [
      span({ id: "x", start: 0, end: 10, tool: "Bash", tokens: tokens(1_000_000, 1_000_000), model: "gpt-truc" }),
      span({ id: "z", start: 10, end: 20, type: "text", tokens: tokens(1_000_000, 0) }),
    ];
    const m = computeMetrics(buildSession(spans), {}, pricing);
    expect(m.costUsd).toBeCloseTo(1 + 2 + 1); // défaut : input 1, output 2
  });

  it("appels répétés : thinking entre deux appels n'interrompt pas, un autre outil si", () => {
    const input = { command: "ls" };
    const spans = [
      span({ id: "r1", tool: "Bash", start: 0, end: 10, input }),
      span({ id: "th", type: "thinking", start: 10, end: 20 }),
      span({ id: "r2", tool: "Bash", start: 20, end: 30, input }),
      span({ id: "o", tool: "Read", start: 30, end: 40, input }),
      span({ id: "r3", tool: "Bash", start: 40, end: 50, input }), // suite interrompue : seul
      span({ id: "d1", tool: "Bash", start: 50, end: 60, input: { command: "pwd" } }), // autres arguments
    ];
    const m = computeMetrics(buildSession(spans), {}, pricing);
    expect(m.repeated).toHaveLength(1);
    expect(m.repeated[0]).toMatchObject({ tool: "Bash", count: 2, spanIds: ["r1", "r2"] });
    expect(m.repeated[0].inputKey).toBe(JSON.stringify(input));
  });

  it("appels répétés : inputKey tronquée à 120 caractères", () => {
    const input = { command: "x".repeat(300) };
    const spans = [
      span({ id: "a", tool: "Bash", start: 0, end: 1, input }),
      span({ id: "b", tool: "Bash", start: 2, end: 3, input }),
    ];
    const m = computeMetrics(buildSession(spans), {}, pricing);
    expect(m.repeated[0].inputKey).toHaveLength(120);
  });
});
