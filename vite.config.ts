import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le front tourne sur Vite (5173) et renvoie /api vers le serveur Express (3001).
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3001" } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  test: { root: "../..", include: ["tests/**/*.test.ts"] },
});
