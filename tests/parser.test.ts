import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSession } from "../src/server/parser";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const session = () => parseSession("demo", read("main.jsonl"), [{ agentId: "sub1", text: read("agent-sub1.jsonl") }]);
const span = (id: string) => session().spans.find((s) => s.id === id)!;

describe("parseSession", () => {
  it("crée la lane principale et une lane de sous-agent nommée par la description", () => {
    const s = session();
    expect(s.lanes.map((l) => l.id)).toEqual(["main", "sub1"]);
    expect(s.lanes[1]).toMatchObject({ type: "subagent", parentLaneId: "main", name: "Fait un sous-travail" });
    expect(s.project).toBe("/demo/projet");
  });

  it("calcule la durée d'un outil entre tool_use et tool_result", () => {
    expect(span("t_read")).toMatchObject({ start: Date.parse("2026-01-01T10:00:09Z"), end: Date.parse("2026-01-01T10:00:10Z"), status: "ok" });
  });

  it("marque une erreur quand is_error est vrai", () => {
    expect(span("t_bash").status).toBe("error");
  });

  it("compte les tokens une seule fois par requestId", () => {
    const withTokens = session().spans.filter((s) => s.tokens && s.laneId === "main");
    const r1 = withTokens.filter((s) => s.tokens!.cacheRead === 100);
    expect(r1).toHaveLength(1); // r1 est écrit sur 2 lignes (thinking + Write)
    expect(r1[0].type).toBe("thinking");
    expect(r1[0].tokens!.thinking).toBe(30);
  });

  it("crée un span thinking sans contenu, avec sa durée", () => {
    const thinking = session().spans.find((s) => s.type === "thinking")!;
    expect(thinking.end - thinking.start).toBe(3000);
    expect(thinking.thinkingContent).toBeUndefined();
  });

  it("n'ajoute pas deux fois l'appel Agent rejoué dans le fichier du sous-agent", () => {
    expect(session().spans.filter((s) => s.id === "t_agent")).toHaveLength(1);
    // et ses tokens (requestId r4) ne sont pas recomptés dans la lane du sous-agent
    expect(session().spans.filter((s) => s.laneId === "sub1" && s.tokens)).toHaveLength(1);
  });

  it("prend la fin d'un agent async dans la task-notification", () => {
    expect(span("t_agent")).toMatchObject({ type: "subagent", agentId: "sub1", status: "ok", end: Date.parse("2026-01-01T10:01:00Z") });
  });

  it("crée les dépendances spawn, result et data", () => {
    const deps = session().dependencies;
    expect(deps).toContainEqual({ fromSpanId: "t_agent", toSpanId: "s_grep", type: "spawn" });
    expect(deps).toContainEqual({ fromSpanId: "s_grep", toSpanId: "t_agent", type: "result" });
    expect(deps).toContainEqual({ fromSpanId: "t_write", toSpanId: "t_read", type: "data" });
  });

  it("ignore une ligne JSON corrompue et gère une session vide", () => {
    const bad = parseSession("x", read("main.jsonl") + "{pas du json\n", []);
    expect(bad.spans.length).toBeGreaterThan(0);
    expect(parseSession("vide", "", [])).toMatchObject({ spans: [], start: 0, end: 0 });
  });
});
