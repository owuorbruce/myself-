import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
// The OCR engine and English language data, served from ocr/ so text
// recognition works offline. They are cached the first time OCR runs.
const ocrFiles: Record<string, string> = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js":
    "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
const ocrSource = (name: string) =>
  path.join(process.cwd(), "node_modules", ocrFiles[name]);
function ocrAssets(): Plugin {
  return {
    name: "slate-ocr-assets",
    generateBundle() {
      for (const name of Object.keys(ocrFiles))
        this.emitFile({
          type: "asset",
          fileName: "ocr/" + name,
          source: readFileSync(ocrSource(name)),
        });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].split("/ocr/")[1];
        if (!name || !ocrFiles[name]) return next();
        res.setHeader(
          "Content-Type",
          name.endsWith(".js") ? "text/javascript" : "application/gzip",
        );
        res.end(readFileSync(ocrSource(name)));
      });
    },
  };
}
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "./",
  plugins: [
    react(),
    ocrAssets(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Slate — Personal workspace",
        short_name: "Slate",
        description:
          "Your notes, projects, and study cards. Available offline.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f8fafc",
        theme_color: "#1f3531",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,png,svg,woff2}"],
        globIgnores: ["ocr/**"],
        runtimeCaching: [
          {
            urlPattern: /\/ocr\/[^/]+$/,
            handler: "CacheFirst",
            options: { cacheName: "slate-ocr", expiration: { maxEntries: 8 } },
          },
        ],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1100 },
});
