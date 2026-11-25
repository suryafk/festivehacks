import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = process.env.API_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/audio": { target: api, changeOrigin: true },
      "/healthz": { target: api, changeOrigin: true },
    },
  },
});
