import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { compileDeck, renderSlideSvg } from "@slideck/core";
import { renderPdf } from "@slideck/core/pdf";
import { NodeAssetResolver } from "./node-resolver";
import { serve, type ServeOptions } from "./server";

const USAGE = `slideck — editing server for YAML slides / PDF and SVG builds

Usage:
  slideck new [name]                  create a sample project in name/ (default: my-deck)
  slideck serve [dir]                 open a directory in the editing server (default: current)
  slideck export <deck.yaml> [opts]   build to PDF/SVG

serve options:
  -p, --port <n>     listen port (default: 4321, bumped up if taken)
  --host <h>         listen host (default: localhost)
  --no-open          do not open the browser automatically

export options:
  -o, --out <file>   output PDF path (default: <deck>.pdf)
  --svg <dir>        directory to also output each slide as SVG

  -h, --help         this help
`;

// Location of the web build artifacts. In the published package this is dist/web,
// in repo dev it is packages/web/dist.
function webDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "web"), join(here, "..", "..", "web", "dist")];
  for (const c of candidates) if (existsSync(join(c, "index.html"))) return c;
  throw new Error("web build artifacts not found. Run `pnpm --filter @slideck/web build`.");
}

// Location of the bundled sample (examples/basic). In the published package this is
// dist/web, in dev it is web's dist or public.
function sampleDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "web", "examples", "basic"),
    join(here, "..", "..", "web", "dist", "examples", "basic"),
    join(here, "..", "..", "web", "public", "examples", "basic"),
  ];
  for (const c of candidates) if (existsSync(join(c, "manifest.json"))) return c;
  throw new Error("sample not found.");
}

async function cmdNew(args: string[]): Promise<void> {
  const name = args.find((a) => !a.startsWith("-")) ?? "my-deck";
  const target = resolve(name);

  // Do not overwrite an existing directory unless it is empty.
  if (existsSync(target) && (await readdir(target).catch(() => [])).length > 0) {
    console.error(`already exists and is not empty: ${target}`);
    process.exit(1);
  }

  // Copy only the files listed in manifest.json (the manifest itself is excluded).
  const src = sampleDir();
  const { files } = JSON.parse(await readFile(join(src, "manifest.json"), "utf8")) as {
    files: string[];
  };
  for (const rel of files) {
    const to = join(target, rel);
    await mkdir(dirname(to), { recursive: true });
    await cp(join(src, rel), to);
  }

  console.log(`created: ${target} (${files.length} files)`);
  console.log(`  cd ${name} && slideck serve`);
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

  // Verify deck.yaml is readable (for a clearer error).
  await readFile(deckPath, "utf8").catch(() => {
    console.error(`deck not found: ${deckPath}`);
    process.exit(1);
  });

  const { compiled, errors } = await compileDeck(new NodeAssetResolver(root), { entry });
  for (const e of errors) console.error(`! ${e.message}`);
  if (!compiled) {
    console.error("compilation failed.");
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

  if (cmd === "new") return cmdNew(rest);
  if (cmd === "serve") return cmdServe(rest);
  if (cmd === "export") return cmdExport(rest);
  if (cmd === "-h" || cmd === "--help" || cmd === undefined) {
    process.stdout.write(USAGE);
    process.exit(cmd === undefined ? 1 : 0);
  }
  // Backward compat: treat a first arg ending in .yaml as a build.
  if (/\.ya?ml$/i.test(cmd)) return cmdExport(argv);

  console.error(`unknown command: ${cmd}`);
  process.stdout.write(USAGE);
  process.exit(1);
}

void main();
