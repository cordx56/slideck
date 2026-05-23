import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compileDeck, renderSlideSvg } from "@slideck/core";
import { renderPdf } from "@slideck/core/pdf";
import { NodeAssetResolver } from "./node-resolver";
import { serve, type ServeOptions } from "./server";

const USAGE = `slideck — YAML スライドの編集サーバ / PDF・SVG ビルド

使い方:
  slideck serve [dir]                 ディレクトリを編集サーバで開く (既定: カレント)
  slideck export <deck.yaml> [opts]   PDF/SVG にビルド

serve オプション:
  -p, --port <n>     待ち受けポート (既定: 4321、埋まっていれば繰り上げ)
  --host <h>         待ち受けホスト (既定: localhost)
  --no-open          ブラウザを自動で開かない

export オプション:
  -o, --out <file>   出力 PDF パス (既定: <deck>.pdf)
  --svg <dir>        各スライドを SVG でも出力するディレクトリ

  -h, --help         このヘルプ
`;

// web のビルド成果物の場所。公開パッケージでは dist/web、リポジトリ内 dev では
// packages/web/dist を見る。
function webDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "web"), join(here, "..", "..", "web", "dist")];
  for (const c of candidates) if (existsSync(join(c, "index.html"))) return c;
  throw new Error(
    "web のビルド成果物が見つかりません。`pnpm --filter @slideck/web build` を実行してください。",
  );
}

async function cmdServe(args: string[]): Promise<void> {
  let dir = ".";
  const opts: ServeOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-p" || a === "--port") opts.port = Number(args[++i]);
    else if (a === "--host") opts.host = args[++i];
    else if (a === "--no-open") opts.open = false;
    else if (!a.startsWith("-")) dir = a;
  }
  await serve(dir, webDir(), opts);
}

async function cmdExport(args: string[]): Promise<void> {
  let deck: string | undefined;
  let out: string | undefined;
  let svgDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--svg") svgDir = args[++i];
    else if (!a.startsWith("-")) deck = a;
  }
  if (!deck) {
    process.stdout.write(USAGE);
    process.exit(1);
  }

  const deckPath = resolve(deck);
  const root = dirname(deckPath);
  const entry = basename(deckPath);

  // deck.yaml が読めるか確認 (分かりやすいエラーのため)。
  await readFile(deckPath, "utf8").catch(() => {
    console.error(`deck が見つかりません: ${deckPath}`);
    process.exit(1);
  });

  const { compiled, errors } = await compileDeck(new NodeAssetResolver(root), { entry });
  for (const e of errors) console.error(`! ${e.message}`);
  if (!compiled) {
    console.error("コンパイルに失敗しました。");
    process.exit(1);
  }

  const outPath = out ?? deckPath.replace(/\.[^.]+$/, "") + ".pdf";
  const { bytes, errors: pdfErrors } = await renderPdf(compiled);
  for (const e of pdfErrors) console.error(`! ${e.message}`);
  await writeFile(outPath, bytes);

  let svgNote = "";
  if (svgDir) {
    await mkdir(svgDir, { recursive: true });
    compiled.deck.slides.forEach((slide, i) => {
      const svg = renderSlideSvg(compiled, i) ?? "";
      void writeFile(resolve(svgDir!, `${String(i + 1).padStart(2, "0")}-${slide.id}.svg`), svg);
    });
    svgNote = `, SVG -> ${svgDir}/`;
  }

  console.log(`wrote ${outPath} (${compiled.deck.slides.length} slides)${svgNote}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;

  if (cmd === "serve") return cmdServe(rest);
  if (cmd === "export") return cmdExport(rest);
  if (cmd === "-h" || cmd === "--help" || cmd === undefined) {
    process.stdout.write(USAGE);
    process.exit(cmd === undefined ? 1 : 0);
  }
  // 後方互換: 第一引数が .yaml ならビルド扱い。
  if (/\.ya?ml$/i.test(cmd)) return cmdExport(argv);

  console.error(`不明なコマンド: ${cmd}`);
  process.stdout.write(USAGE);
  process.exit(1);
}

void main();
