import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// On GitHub Pages the app is served from /<repo>/. The workflow sets
// GITHUB_PAGES_BASE; local development and tests use "/".
const base = process.env.GITHUB_PAGES_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
