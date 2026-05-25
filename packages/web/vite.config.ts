/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Canonical site origin for absolute OGP/Twitter URLs; override per deploy.
const SITE_URL = process.env.VITE_SITE_URL ?? "https://slideck.56.ax";

// Substitute the __SITE_URL__ placeholder in index.html (build + dev).
function siteUrlHtml(): Plugin {
  return {
    name: "slideck-site-url",
    transformIndexHtml: (html) => html.split("__SITE_URL__").join(SITE_URL),
  };
}

// base is switched via an env var to support subpath hosting under GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [svelte(), siteUrlHtml()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
