// @slideck/cli を公開可能な単一ファイルにビルドする。
// 1) cli + @slideck/core を 1 つの ESM にバンドル (dist/cli.js)
// 2) web のビルド成果物を dist/web へコピー (serve で静的配信)
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

// web 成果物が無ければ先にビルド (単独 publish でも完結させる)。
if (!existsSync(join(webDist, "index.html"))) {
  console.log("web の成果物が無いのでビルドします...");
  execSync("pnpm --filter @slideck/web build", { stdio: "inherit", cwd: resolve(root, "..", "..") });
}

// ESM 出力。import.meta.url を保ちつつ、バンドルした CJS 依存が使う
// require/__dirname/__filename を shim で補う。
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
