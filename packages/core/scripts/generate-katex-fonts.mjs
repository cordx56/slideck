import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = join(root, "node_modules", "katex", "dist", "fonts");
const katexPackage = JSON.parse(
  await readFile(join(root, "node_modules", "katex", "package.json"), "utf8"),
);
const names = [
  "AMS-Regular",
  "Caligraphic-Bold",
  "Caligraphic-Regular",
  "Fraktur-Bold",
  "Fraktur-Regular",
  "Main-Bold",
  "Main-BoldItalic",
  "Main-Italic",
  "Main-Regular",
  "Math-BoldItalic",
  "Math-Italic",
  "SansSerif-Bold",
  "SansSerif-Italic",
  "SansSerif-Regular",
  "Script-Regular",
  "Size1-Regular",
  "Size2-Regular",
  "Size3-Regular",
  "Size4-Regular",
  "Typewriter-Regular",
];

const entries = await Promise.all(
  names.map(async (name) => {
    const data = await readFile(join(fontDir, `KaTeX_${name}.ttf`));
    return `  ["${name}", "${data.toString("base64")}"],`;
  }),
);

const output =
  `// Generated from KaTeX ${katexPackage.version} by scripts/generate-katex-fonts.mjs. Do not edit.\n` +
  `export const KATEX_FONT_BASE64: ReadonlyArray<readonly [string, string]> = [\n` +
  entries.join("\n") +
  `\n];\n`;

await writeFile(join(root, "src", "generated", "katex-font-data.ts"), output);
