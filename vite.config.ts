/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// base はGitHub Pages配下のサブパス配信を想定して環境変数で切り替える。
// ローカル/ルート配信時は "/" のまま。
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [svelte()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
