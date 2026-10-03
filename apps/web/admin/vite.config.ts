import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  /* Relative, so the built site works at ANY path without being rebuilt.

     GitHub Pages serves a project site from /<repo>/ (here
     https://leruo24.github.io/AgroFlow/), not from the domain root. With the
     default base of "/" every asset would be requested from the domain root
     and 404, which is the classic "blank page on Pages" failure.

     "./" rather than hardcoding "/AgroFlow/" because the repo could be
     renamed, the site could move to a custom domain, and `vite preview` and
     the Railway-hosted copy all serve from different roots. The app routes on
     the HASH (#/login, #dashboard), so relative asset paths are all it needs -
     there is no server-side path resolution to get wrong. */
  base: "./",

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
