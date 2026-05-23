import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { AssetResolver } from "@slider/core";
import { normalizePath } from "@slider/core";
import { compileDeck } from "@slider/core";
import { renderPdf } from "@slider/core/pdf";

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

describe("renderPdf", () => {
  it("実フォントを subset 埋め込みした PDF を生成する", async () => {
    const resolver = new DiskResolver(
      resolve(__dirname, "../public/examples/basic"),
    );
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);

    const { bytes, errors: pdfErrors } = await renderPdf(compiled!);
    expect(pdfErrors).toHaveLength(0);

    // 妥当な PDF で、スライド数ぶんのページがある。
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(0).getWidth()).toBe(1920);
    expect(doc.getPage(0).getHeight()).toBe(1080);

    // TrueType フォントが埋め込まれている (FontFile2) ことを確認。
    // 既定の save は object stream で圧縮されるため、検査用に展開して再保存。
    const inspectable = await doc.save({ useObjectStreams: false });
    const raw = new TextDecoder("latin1").decode(inspectable);
    expect(raw).toContain("FontFile2");
    expect(raw).toContain("Type0"); // CJK 用 composite font
  });
});
