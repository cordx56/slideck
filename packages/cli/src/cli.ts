#!/usr/bin/env tsx
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { compileDeck, renderSlideSvg } from "@slider/core";
import { renderPdf } from "@slider/core/pdf";
import { NodeAssetResolver } from "./node-resolver";

interface Options {
  deck: string;
  out?: string;
  svgDir?: string;
}

function parseArgs(argv: string[]): Options | null {
  const opts: Partial<Options> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "--svg") opts.svgDir = argv[++i];
    else if (a === "-h" || a === "--help") return null;
    else if (!a.startsWith("-")) opts.deck = a;
  }
  return opts.deck ? (opts as Options) : null;
}

const USAGE = `slider — YAML スライドを PDF/SVG にビルド

使い方:
  slider <deck.yaml> [-o out.pdf] [--svg <dir>]

オプション:
  -o, --out <file>   出力 PDF パス (既定: <deck>.pdf)
  --svg <dir>        各スライドを SVG でも出力するディレクトリ
  -h, --help         このヘルプ
`;

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stdout.write(USAGE);
    process.exit(process.argv.length <= 2 ? 1 : 0);
  }

  const deckPath = resolve(opts.deck);
  const root = dirname(deckPath);
  const entry = basename(deckPath);

  // deck.yaml が読めるか確認 (分かりやすいエラーのため)。
  await readFile(deckPath, "utf8").catch(() => {
    console.error(`deck が見つかりません: ${deckPath}`);
    process.exit(1);
  });

  const { compiled, errors } = await compileDeck(new NodeAssetResolver(root), {
    entry,
  });
  for (const e of errors) console.error(`! ${e.message}`);
  if (!compiled) {
    console.error("コンパイルに失敗しました。");
    process.exit(1);
  }

  const out = opts.out ?? deckPath.replace(/\.[^.]+$/, "") + ".pdf";
  const { bytes, errors: pdfErrors } = await renderPdf(compiled);
  for (const e of pdfErrors) console.error(`! ${e.message}`);
  await writeFile(out, bytes);

  let svgNote = "";
  if (opts.svgDir) {
    await mkdir(opts.svgDir, { recursive: true });
    compiled.deck.slides.forEach((slide, i) => {
      const svg = renderSlideSvg(compiled, i) ?? "";
      void writeFile(resolve(opts.svgDir!, `${String(i + 1).padStart(2, "0")}-${slide.id}.svg`), svg);
    });
    svgNote = `, SVG -> ${opts.svgDir}/`;
  }

  console.log(`wrote ${out} (${compiled.deck.slides.length} slides)${svgNote}`);
}

void main();
