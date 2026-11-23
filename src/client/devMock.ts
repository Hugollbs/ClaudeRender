// Session factice pour développer l'interface sans backend.
// Tout est déterministe (générateur pseudo-aléatoire à graine fixe) : mêmes données à chaque chargement.
import type { Dependency, Lane, Session, Span } from "../shared/types";

const START = Date.UTC(2026, 0, 15, 9, 0, 0);

// mulberry32 : petit générateur pseudo-aléatoire reproductible (Math.random ne l'est pas).
function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILES = ["src/App.tsx", "src/api.ts", "src/utils.ts", "README.md", "package.json", "src/server.ts"];
const TOOLS = [
  "Read", "Read", "Read", "Grep", "Glob", "Edit", "Edit", "Write",
  "Bash", "Bash", "WebSearch", "WebFetch", "mcp__github__get_issue",
];

export function generateBigMockSession(n: number): Session {
  return buildSession(n, 42, `mock-${n}`);
}

function buildSession(total: number, seed: number, id: string): Session {
  const rand = makeRandom(seed);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];

  const lanes: Lane[] = [
    { id: "main", name: "Agent principal", type: "main" },
    { id: "sub-a", name: "Explorer le dépôt", type: "subagent", parentLaneId: "main" },
    { id: "sub-b", name: "Chercher les tests (imbriqué)", type: "subagent", parentLaneId: "sub-a" },
  ];
  const spans: Span[] = [];
  const dependencies: Dependency[] = [];
  let counter = 0;
  const lastReadOfFile = new Map<string, string>(); // clé "lane:fichier" -> id du dernier Read

  // Génère `count` spans à la suite dans une lane, à partir de `from`. Retourne l'instant de fin.
  function fillLane(laneId: string, count: number, from: number): number {
    let cursor = from;
    for (let i = 0; i < count; i++) {
      const roll = rand();
      const gap = between(50, 800);
      let start = cursor + gap;
      // ~10 % des outils sont lancés en parallèle du précédent (spans qui se chevauchent).
      if (roll > 0.9 && i > 0) start = cursor - between(100, 600);

      let span: Span;
      const kind = rand();
      if (kind < 0.2) {
        const duration = between(2000, 12_000);
        span = {
          id: `s${counter++}`, laneId, type: "thinking", start, end: start + duration,
          status: "ok", summary: "Réflexion",
          tokens: { input: 1200, output: Math.round(duration / 8), cacheRead: 9000, cacheCreation: 0, thinking: Math.round(duration / 10) },
          model: "claude-sonnet-4-5",
        };
        // Cas exceptionnel : un thinking avec contenu, pour tester le tooltip.
        if (counter % 40 === 0) span.thinkingContent = "Je dois d'abord lire le fichier de configuration. Ensuite je modifierai la fonction.";
      } else if (kind < 0.3) {
        const duration = between(800, 4000);
        span = {
          id: `s${counter++}`, laneId, type: "text", start, end: start + duration,
          status: "ok", summary: "Je vais maintenant corriger le bug dans le routeur.",
          detail: "Je vais maintenant corriger le bug dans le routeur, puis relancer les tests.",
        };
      } else {
        const tool = pick(TOOLS);
        const duration = tool === "Bash" ? between(300, 20_000) : tool.startsWith("Web") ? between(1500, 9000) : between(80, 2500);
        const file = pick(FILES);
        const isError = rand() < 0.05;
        span = {
          id: `s${counter++}`, laneId, type: "tool", tool, start, end: start + duration,
          status: isError ? "error" : "ok",
          summary: tool === "Bash" ? "npm test" : tool === "WebSearch" ? "react svg timeline zoom" : file,
          detail: isError ? "Error: commande terminée avec le code 1" : "OK",
        };
        if (["Read", "Edit", "Write"].includes(tool)) span.filePath = file;
      }
      // Un span "tokens" sur 6 environ porte l'usage d'une requête API.
      if (!span.tokens && rand() < 0.15) {
        span.tokens = { input: Math.round(between(200, 3000)), output: Math.round(between(50, 900)), cacheRead: Math.round(between(0, 20000)), cacheCreation: 0, thinking: 0 };
        span.model = "claude-sonnet-4-5";
      }
      spans.push(span);
      cursor = Math.max(cursor, span.end);

      // Dépendance "data" : un Read d'un fichier suivi d'un Edit/Write du même fichier dans la même lane.
      if (span.filePath) {
        const key = `${laneId}:${span.filePath}`;
        const previousRead = lastReadOfFile.get(key);
        if (span.tool === "Read") lastReadOfFile.set(key, span.id);
        else if (previousRead) dependencies.push({ fromSpanId: previousRead, toSpanId: span.id, type: "data" });
      }
    }
    return cursor;
  }

  // Scénario : main -> lance sub-a -> qui lance sub-b -> résultats remontent -> main continue.
  const mainBefore = Math.floor(total * 0.25);
  const subA1 = Math.floor(total * 0.1);
  const subB = Math.floor(total * 0.2);
  const subA2 = Math.floor(total * 0.2);
  const mainAfter = Math.max(1, total - mainBefore - subA1 - subB - subA2);

  const spawnATime = fillLane("main", mainBefore, START);
  const aFirstIndex = spans.length;
  const spawnBTime = fillLane("sub-a", subA1, spawnATime);
  const bFirstIndex = spans.length;
  const bEnd = fillLane("sub-b", subB, spawnBTime);
  const bLastIndex = spans.length - 1;
  const aEnd = fillLane("sub-a", subA2, bEnd);
  const aLastIndex = spans.length - 1;

  // Spans de type "subagent" dans la lane du parent : couvrent toute l'exécution du sous-agent.
  const subSpanB: Span = {
    id: `s${counter++}`, laneId: "sub-a", type: "subagent", tool: "Task", agentId: "sub-b",
    start: spawnBTime, end: bEnd, status: "ok", summary: "Chercher les tests",
  };
  const subSpanA: Span = {
    id: `s${counter++}`, laneId: "main", type: "subagent", tool: "Task", agentId: "sub-a",
    start: spawnATime, end: aEnd, status: "ok", summary: "Explorer le dépôt",
  };
  spans.push(subSpanB, subSpanA);
  dependencies.push(
    { fromSpanId: subSpanA.id, toSpanId: spans[aFirstIndex].id, type: "spawn" },
    { fromSpanId: subSpanB.id, toSpanId: spans[bFirstIndex].id, type: "spawn" },
    { fromSpanId: spans[bLastIndex].id, toSpanId: subSpanB.id, type: "result" },
    { fromSpanId: spans[aLastIndex].id, toSpanId: subSpanA.id, type: "result" },
  );

  const mainEnd = fillLane("main", mainAfter, aEnd);
  // Le tout dernier span de l'agent principal est "en cours", pour tester ce rendu.
  const last = spans[spans.length - 1];
  last.status = "running";
  last.end = mainEnd + 1500;

  const end = Math.max(...spans.map((s) => s.end));
  return { id, project: "/Users/demo/mon-projet", start: START, end, lanes, spans, dependencies };
}

export const mockSession: Session = buildSession(300, 7, "mock-session");
