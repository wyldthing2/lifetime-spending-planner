import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "github-pages",
  base: "/lifetime-spending-planner/",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), ".") },
  },
  build: {
    outDir: "../github-pages-dist",
    emptyOutDir: true,
  },
});
