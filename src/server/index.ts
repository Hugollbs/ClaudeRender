import express from "express";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listLive } from "./live.js";
import { DEFAULT_PROJECTS_DIR, listSessions, loadSession } from "./sessions.js";

const DEFAULT_PORT = 3001;
const HOST = "127.0.0.1"; // outil local, données privées : jamais exposé sur le réseau
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRICING_FILE = join(PROJECT_ROOT, "config", "pricing.json");
const CLIENT_DIST = join(PROJECT_ROOT, "dist", "client");

// Noms d'hôte acceptés. Sans ce contrôle, un site web malveillant pourrait faire résoudre son
// propre domaine vers 127.0.0.1 (attaque "DNS rebinding") et lire vos transcripts via le navigateur.
const ALLOWED_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function createApp(root: string = DEFAULT_PROJECTS_DIR) {
  const app = express();

  app.use((req, res, next) => {
    if (!ALLOWED_HOST.test(req.headers.host ?? "")) {
      res.status(403).json({ error: "Hôte non autorisé" });
      return;
    }
    next();
  });

  app.get("/api/sessions", async (_req, res) => {
    try {
      res.json(await listSessions(root));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/live", async (_req, res) => {
    try {
      res.json(await listLive(root));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await loadSession(root, req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session introuvable" });
        return;
      }
      res.json(session);
    } catch (err) {
      // Typiquement : le parseur a levé sur un transcript inattendu.
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/pricing", async (_req, res) => {
    try {
      res.type("application/json").send(await readFile(PRICING_FILE, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "config/pricing.json introuvable" });
        return;
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // En production, le client buildé est servi par le même serveur.
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
  }

  return app;
}

// Ne démarre l'écoute que si ce fichier est lancé directement (pas quand un test l'importe).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  createApp().listen(port, HOST, () => {
    console.log(`ClaudeRender : http://${HOST}:${port}`);
  });
}
