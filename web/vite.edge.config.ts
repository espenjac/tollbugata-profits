import { defineConfig } from "vite";

// Builds the shared TypeScript core into a single ESM file that the
// `simulator-tick` Edge Function imports. Run with `npm run build:edge` from
// the web folder; the generated strategy.mjs is committed so `supabase
// functions deploy` does not need a Node build step.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "../supabase/functions/simulator-tick",
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    lib: {
      entry: "src/core/edge.ts",
      formats: ["es"],
      fileName: () => "strategy.mjs",
    },
  },
});
