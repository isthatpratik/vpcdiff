import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The viewer never sends plan data off the device (AGENTS.md). In the build, this
// Content Security Policy blocks every network request from the page and its worker:
// connect-src 'none'. The dev server needs a websocket, so the policy is build only.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "worker-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "vpcdiff-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // Relative paths, so the build works from any GitHub Pages subpath.
  base: "./",
  plugins: [react(), csp()],
  worker: { format: "es" },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: { target: "es2023" },
});
