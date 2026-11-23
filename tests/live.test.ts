import { describe, expect, it } from "vitest";
import type { Session, Span } from "../src/shared/types.js";
import { summarizeLive } from "../src/server/live.js";

const span = (over: Partial<Span>): Span => ({
  id: "s", laneId: "main", type: "tool", start: 0, end: 0, status: "ok", summary: "", ...over,
});

const base: Session = {
  id: "abc", project: "/p", start: 0, end: 5000,
  lanes: [
    { id: "main", name: "Agent principal", type: "main" },
    { id: "a1", name: "un", type: "subagent", parentLaneId: "main" },
    { id: "a2", name: "deux", type: "subagent", parentLaneId: "main" },
  ],
  spans: [
    span({ id: "1", type: "subagent", agentId: "a1", start: 100, end: 4000, status: "ok", summary: "lance a1" }),
    span({ id: "2", type: "subagent", agentId: "a2", start: 200, end: 5000, status: "running", summary: "lance a2" }),
    span({ id: "3", tool: "Bash", start: 900, end: 950, summary: "npm test" }),
  ],
  dependencies: [],
};

describe("summarizeLive", () => {
  it("compte les sous-agents terminés et en cours", () => {
    const live = summarizeLive(base);
    expect(live.agentsTotal).toBe(2);
    expect(live.agentsRunning).toBe(1);
    expect(live.agentsDone).toBe(1);
    expect(live.hasRunningSpan).toBe(true);
  });

  it("prend comme dernière action le span qui a démarré en dernier", () => {
    const live = summarizeLive(base);
    expect(live.lastAction).toBe("npm test");
    expect(live.lastTool).toBe("Bash");
    expect(live.lastActivity).toBe(5000);
  });

  it("ne renvoie jamais un nombre de terminés négatif (spans d'agent sans lane)", () => {
    const live = summarizeLive({ ...base, lanes: [base.lanes[0]] });
    expect(live.agentsTotal).toBe(2); // les 2 spans d'agent comptent même sans lane
    expect(live.agentsDone).toBeGreaterThanOrEqual(0);
  });

  it("gère une session sans aucun span", () => {
    const live = summarizeLive({ ...base, spans: [], lanes: [base.lanes[0]] });
    expect(live.lastAction).toBe("");
    expect(live.agentsTotal).toBe(0);
    expect(live.hasRunningSpan).toBe(false);
  });
});
