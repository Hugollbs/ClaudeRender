import { defineConfig } from "vitest/config";

// Config séparée de vite.config.ts : là-bas, root = src/client (pour le front),
// ce qui faisait chercher les tests au mauvais endroit.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
