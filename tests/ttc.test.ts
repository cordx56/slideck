import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isTtc, extractFontFromTtc } from "../src/load/ttc";
import { createFkFont, FontkitMetrics } from "../src/lower/fontkit-metrics";

function measure(bytes: Uint8Array, text: string): number {
  const font = createFkFont(bytes);
  expect(font).toBeTruthy();
  return new FontkitMetrics(new Map([["x", font!]])).measure(text, "x", 100);
}

// 単独 TTF を 1 フォントだけの TTC コンテナに包む (テスト用)。
function wrapAsTtc(ttf: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + ttf.length);
  out.set(ttf, 16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x74746366); // 'ttcf'
  dv.setUint32(4, 0x00010000); // version 1.0
  dv.setUint32(8, 1); // numFonts
  dv.setUint32(12, 16); // フォントディレクトリへのオフセット
  // 包んだ TTF のテーブルオフセットを +16 する。
  const numTables = dv.getUint16(16 + 4);
  for (let i = 0; i < numTables; i++) {
    const recOff = 16 + 12 + i * 16;
    dv.setUint32(recOff + 8, dv.getUint32(recOff + 8) + 16);
  }
  return out;
}

const ttfPath = resolve(__dirname, "../public/examples/basic/fonts/IPAexGothic.ttf");

describe("ttc", () => {
  it("isTtc は ttcf シグネチャを判定する", async () => {
    const ttf = new Uint8Array(await readFile(ttfPath));
    expect(isTtc(ttf)).toBe(false);
    expect(isTtc(wrapAsTtc(ttf))).toBe(true);
  });

  it("TTC から単独 SFNT を取り出して fontkit で読める", async () => {
    const ttf = new Uint8Array(await readFile(ttfPath));
    const ttc = wrapAsTtc(ttf);
    const extracted = extractFontFromTtc(ttc, 0);

    expect(isTtc(extracted)).toBe(false); // もう TTC ではない
    // sfntVersion が元 TTF と一致 (glyf TrueType = 0x00010000)。
    expect(new DataView(extracted.buffer).getUint32(0)).toBe(
      new DataView(ttf.buffer, ttf.byteOffset).getUint32(0),
    );

    expect(measure(extracted, "あ")).toBeGreaterThan(0);
  });

  it("範囲外 index はエラー", async () => {
    const ttc = wrapAsTtc(new Uint8Array(await readFile(ttfPath)));
    expect(() => extractFontFromTtc(ttc, 5)).toThrow();
  });

  // 実在の TTC (NotoSansCJK) があれば複数フォントの取り出しを検証。
  const notoTtc = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
  it.skipIf(!existsSync(notoTtc))("実 TTC から複数フォントを取り出せる", async () => {
    const bytes = new Uint8Array(await readFile(notoTtc));
    expect(isTtc(bytes)).toBe(true);
    expect(measure(extractFontFromTtc(bytes, 0), "漢字")).toBeGreaterThan(0);
    expect(measure(extractFontFromTtc(bytes, 1), "漢字")).toBeGreaterThan(0);
  });
});
