// 例デッキを PDF にレンダリングして /tmp に保存する検証用スクリプト。
// 実行: npx vite-node scripts/render-pdf.ts
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetResolver } from "../src/load/assets";
import { normalizePath } from "../src/load/assets";
import { compileDeck } from "../src/pipeline";
import { renderPdf } from "../src/render/pdf";

class DiskResolver implements AssetResolver {
  constructor(private root: string) {}
  private p(rel: string) {
    return resolve(this.root, normalizePath(rel));
  }
  async readText(rel: string) {
    return readFile(this.p(rel), "utf8");
  }
  async readBytes(rel: string) {
    return new Uint8Array(await readFile(this.p(rel)));
  }
  async exists(rel: string) {
    return readFile(this.p(rel)).then(
      () => true,
      () => false,
    );
  }
}

const resolver = new DiskResolver(resolve("public/examples/basic"));
const { compiled, errors } = await compileDeck(resolver);
if (errors.length) console.error("compile errors:", errors.map((e) => e.message));
if (!compiled) process.exit(1);
const { bytes, errors: pdfErrors } = await renderPdf(compiled);
if (pdfErrors.length) console.error("pdf errors:", pdfErrors.map((e) => e.message));
await writeFile("/tmp/slides.pdf", bytes);
console.log(`wrote /tmp/slides.pdf (${bytes.length} bytes)`);
