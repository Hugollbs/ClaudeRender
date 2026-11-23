import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session, SessionSummary } from "../shared/types.js";
import { parseSession, type RawSubagent } from "./parser.js";

// Dossier des transcripts. La variable d'environnement permet de pointer ailleurs (tests, autre machine).
export const DEFAULT_PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");

// On ne lit que le début des fichiers pour la liste : cwd et timestamp sont dans les premières lignes.
const HEAD_BYTES = 64 * 1024;
const HEAD_MAX_LINES = 50;

// Un id de session n'est qu'un nom de fichier : on refuse tout ce qui pourrait contenir "/" ou "..".
const VALID_ID = /^[A-Za-z0-9_-]+$/;

export function isValidId(id: string): boolean {
  return VALID_ID.test(id);
}

// Lit les premiers octets d'un fichier (sans charger un transcript de plusieurs Mo).
async function readHead(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Cherche cwd et le premier timestamp dans les premières lignes.
// La dernière ligne lue peut être coupée par la limite d'octets : le JSON.parse échoue, on l'ignore.
function extractHeadInfo(head: string): { project?: string; start?: number } {
  let project: string | undefined;
  let start: number | undefined;
  for (const line of head.split("\n").slice(0, HEAD_MAX_LINES)) {
    if (!line.trim()) continue;
    let obj: { cwd?: unknown; timestamp?: unknown };
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // ligne tronquée ou corrompue : on passe à la suivante
    }
    if (start === undefined && typeof obj.timestamp === "string") {
      const t = Date.parse(obj.timestamp);
      if (!Number.isNaN(t)) start = t;
    }
    if (project === undefined && typeof obj.cwd === "string") project = obj.cwd;
    if (project !== undefined && start !== undefined) break;
  }
  return { project, start };
}

// Nombre de fichiers agent-*.jsonl dans <projet>/<sessionId>/subagents (0 si le dossier n'existe pas).
async function listSubagentFiles(projectDir: string, sessionId: string): Promise<string[]> {
  try {
    const names = await readdir(join(projectDir, sessionId, "subagents"));
    return names.filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function summarizeFile(
  projectDir: string,
  folderName: string,
  fileName: string,
): Promise<SessionSummary | null> {
  const id = fileName.slice(0, -".jsonl".length);
  const path = join(projectDir, fileName);
  try {
    const info = await stat(path);
    if (info.size === 0) return null;
    const { project, start } = extractHeadInfo(await readHead(path));
    if (start === undefined) {
      console.warn(`[sessions] aucun timestamp lisible, fichier ignoré : ${path}`);
      return null;
    }
    const subagents = await listSubagentFiles(projectDir, id);
    return {
      id,
      project: project ?? folderName,
      start,
      end: Math.max(info.mtimeMs, start), // mtime = dernière écriture, donc fin approximative
      subagentCount: subagents.length,
    };
  } catch (err) {
    console.warn(`[sessions] fichier illisible, ignoré : ${path} (${(err as Error).message})`);
    return null;
  }
}

export async function listSessions(root: string = DEFAULT_PROJECTS_DIR): Promise<SessionSummary[]> {
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[sessions] dossier de transcripts introuvable : ${root}`);
      return [];
    }
    throw err;
  }

  const tasks: Promise<SessionSummary | null>[] = [];
  for (const folder of folders) {
    const projectDir = join(root, folder);
    let files: string[];
    try {
      files = await readdir(projectDir);
    } catch (err) {
      // Un fichier posé directement dans root (ENOTDIR) n'est pas un projet : on le saute.
      console.warn(`[sessions] entrée ignorée : ${projectDir} (${(err as Error).message})`);
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".jsonl") && isValidId(file.slice(0, -".jsonl".length))) {
        tasks.push(summarizeFile(projectDir, folder, file));
      }
    }
  }

  const results = await Promise.all(tasks);
  return results
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => b.start - a.start);
}

// Retrouve le dossier projet qui contient <id>.jsonl, ou null.
async function findSessionDir(root: string, id: string): Promise<string | null> {
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  for (const folder of folders) {
    const projectDir = join(root, folder);
    try {
      if ((await stat(join(projectDir, `${id}.jsonl`))).isFile()) return projectDir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") continue;
      throw err;
    }
  }
  return null;
}

async function readMeta(path: string): Promise<RawSubagent["meta"]> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    // Le meta est facultatif : s'il manque, on continue sans.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[sessions] meta illisible : ${path} (${(err as Error).message})`);
    }
    return undefined;
  }
}

export async function loadSession(
  root: string = DEFAULT_PROJECTS_DIR,
  id: string,
): Promise<Session | null> {
  if (!isValidId(id)) return null; // empêche "../" et tout chemin
  const projectDir = await findSessionDir(root, id);
  if (!projectDir) return null;

  const mainText = await readFile(join(projectDir, `${id}.jsonl`), "utf8");
  const subDir = join(projectDir, id, "subagents");
  const subagents: RawSubagent[] = [];
  for (const file of await listSubagentFiles(projectDir, id)) {
    const agentId = file.slice("agent-".length, -".jsonl".length);
    subagents.push({
      agentId,
      text: await readFile(join(subDir, file), "utf8"),
      meta: await readMeta(join(subDir, `agent-${agentId}.meta.json`)),
    });
  }
  return parseSession(id, mainText, subagents);
}
