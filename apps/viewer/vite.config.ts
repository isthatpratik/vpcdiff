import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The viewer never sends plan data off the device (AGENTS.md). In the build, the
// viewer's Content Security Policy blocks every data request from the page and its
// worker: connect-src 'none'. The landing page holds no plan data, so it may fetch its
// own origin (crawlers and audit tools read robots.txt and llms.txt that way). Nothing
// else is allowed: scripts, styles, fonts, and images all come from this origin (the fonts
// are bundled from src/fonts), so a page makes no third party request at all. The dev
// server needs a websocket, so the policy is build only.
const policy = (connect: string) => [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "worker-src 'self'",
  `connect-src ${connect}`,
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "vpcdiff-csp",
  apply: "build",
  transformIndexHtml: (html, ctx) => {
    const viewer = ctx.filename.replaceAll("\\", "/").endsWith("/app/index.html");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy(viewer ? "'none'" : "'self'")}" />`);
  },
});

export default defineConfig({
  // Relative paths, so the build works from any GitHub Pages subpath.
  base: "./",
  plugins: [react(), tailwindcss(), csp()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: {
    target: "es2023",
    // Two pages on one origin: the landing page at / and the viewer at /app/.
    rollupOptions: {
      input: {
        site: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app/index.html", import.meta.url)),
      },
    },
  },
});
