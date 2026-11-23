import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listSessions, loadSession } from "../src/server/sessions.js";

// On remplace le vrai parseur : ces tests vérifient la lecture des fichiers, pas le parsing.
vi.mock("../src/server/parser.js", () => ({
  parseSession: (id: string, mainText: string, subagents: unknown[]) => ({
    id,
    project: "mock",
    start: 0,
    end: 0,
    lanes: [],
    spans: [],
    dependencies: [],
    mainLength: mainText.length,
    subagents,
  }),
}));

let root: string;
const line = (ts: string, cwd?: string) => JSON.stringify({ timestamp: ts, ...(cwd ? { cwd } : {}) }) + "\n";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "claude-render-test-"));
  const proj = join(root, "-Users-moi-Code-X");
  await mkdir(join(proj, "recente", "subagents"), { recursive: true });
  await writeFile(join(proj, "ancienne.jsonl"), line("2026-01-01T10:00:00.000Z") + line("2026-01-01T10:00:01.000Z", "/Users/moi/Code/X"));
  await writeFile(join(proj, "recente.jsonl"), line("2026-02-01T10:00:00.000Z", "/Users/moi/Code/X"));
  await writeFile(join(proj, "recente", "subagents", "agent-a1.jsonl"), line("2026-02-01T10:00:05.000Z"));
  await writeFile(join(proj, "recente", "subagents", "agent-a1.meta.json"), JSON.stringify({ description: "sous-agent test" }));
  await writeFile(join(proj, "corrompue.jsonl"), "{pas du json\n");
  await writeFile(join(proj, "vide.jsonl"), "");
  await utimes(join(proj, "recente.jsonl"), new Date("2026-02-01T11:00:00Z"), new Date("2026-02-01T11:00:00Z"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listSessions", () => {
  it("trie par début décroissant et ignore les fichiers vides ou corrompus", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = await listSessions(root);
    warn.mockRestore();
    expect(list.map((s) => s.id)).toEqual(["recente", "ancienne"]);
  });

  it("lit le projet, le début, la fin (mtime) et le nombre de sous-agents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [recente, ancienne] = await listSessions(root);
    warn.mockRestore();
    expect(recente.project).toBe("/Users/moi/Code/X");
    expect(recente.start).toBe(Date.parse("2026-02-01T10:00:00.000Z"));
    expect(recente.end).toBe(Date.parse("2026-02-01T11:00:00.000Z"));
    expect(recente.subagentCount).toBe(1);
    expect(ancienne.project).toBe("/Users/moi/Code/X"); // cwd trouvé sur la 2e ligne
    expect(ancienne.subagentCount).toBe(0);
  });

  it("renvoie une liste vide si le dossier n'existe pas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await listSessions(join(root, "absent"))).toEqual([]);
    warn.mockRestore();
  });
});

describe("loadSession", () => {
  it("charge la session avec ses sous-agents et leur meta", async () => {
    const s = (await loadSession(root, "recente")) as unknown as { id: string; subagents: { agentId: string; meta?: { description?: string } }[] };
    expect(s.id).toBe("recente");
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0].agentId).toBe("a1");
    expect(s.subagents[0].meta?.description).toBe("sous-agent test");
  });

  it("renvoie null pour un id inexistant", async () => {
    expect(await loadSession(root, "nexistepas")).toBeNull();
  });

  it("refuse les ids avec traversée de chemin", async () => {
    expect(await loadSession(root, "../etc/passwd")).toBeNull();
    expect(await loadSession(root, "..")).toBeNull();
    expect(await loadSession(root, "a/b")).toBeNull();
  });
});
