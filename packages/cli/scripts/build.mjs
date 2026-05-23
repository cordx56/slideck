// Build @slideck/cli into a single publishable file.
// 1) Bundle cli + @slideck/core into one ESM (dist/cli.js)
// 2) Copy web build artifacts to dist/web (served statically by serve)
import { build } from "esbuild";
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const webDist = resolve(root, "..", "web", "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Build web first if its artifacts are missing (so a standalone publish is self-contained).
if (!existsSync(join(webDist, "index.html"))) {
  console.log("web artifacts missing, building them...");
  execSync("pnpm --filter @slideck/web build", { stdio: "inherit", cwd: resolve(root, "..", "..") });
}

// ESM output. Keep import.meta.url, and shim in require/__dirname/__filename
// used by the bundled CJS dependencies.
const banner = `#!/usr/bin/env node
import { createRequire as __slideckRequire } from 'node:module';
import { fileURLToPath as __slideckFileURL } from 'node:url';
import { dirname as __slideckDir } from 'node:path';
const require = __slideckRequire(import.meta.url);
const __filename = __slideckFileURL(import.meta.url);
const __dirname = __slideckDir(__filename);`;

await build({
  entryPoints: [join(root, "src", "cli.ts")],
  outfile: join(dist, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: banner },
  logLevel: "info",
});

await cp(webDist, join(dist, "web"), { recursive: true });
console.log("cli build done: dist/cli.js + dist/web/");
