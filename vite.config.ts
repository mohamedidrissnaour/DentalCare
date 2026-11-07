import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Front React : construit dans dist/web, servi par le serveur Node (même origine, aucune ressource externe).
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:5080" } },
});
