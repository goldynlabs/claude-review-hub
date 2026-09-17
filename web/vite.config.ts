import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// scripts/dev.mjs picks the API port at start-up, so a claude-review-hub already
// holding 4319 cannot end up being proxied to by mistake.
const apiPort = Number(process.env.API_PORT) || 4319;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4318,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        // A dead API server would otherwise surface as a bare "Internal Server
        // Error" from the proxy, with nothing saying which side failed.
        configure: (proxy) => {
          proxy.on("error", (error, _req, res) => {
            const message = `The API server on :${apiPort} is not responding (${error.message}). Start it with: npm run dev`;
            console.error(`[proxy] ${message}`);
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: message }));
            }
          });
        },
      },
    },
  },
});
