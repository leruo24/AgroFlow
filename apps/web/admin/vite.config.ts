import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  /* Served from the domain root on Vercel and by `vite dev`. The app routes on the
     hash (#/login, #dashboard), so the host needs no rewrite rules. */
  base: "/",

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
