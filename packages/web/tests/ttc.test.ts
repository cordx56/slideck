import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isTtc, extractFontFromTtc } from "@slideck/core";
import { createFkFont, FontkitMetrics } from "@slideck/core";

function measure(bytes: Uint8Array, text: string): number {
  const font = createFkFont(bytes);
  expect(font).toBeTruthy();
  return new FontkitMetrics(new Map([["x", font!]])).measure(text, "x", 100);
}

// Wrap a standalone TTF in a single-font TTC container (for testing).
function wrapAsTtc(ttf: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + ttf.length);
  out.set(ttf, 16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x74746366); // 'ttcf'
  dv.setUint32(4, 0x00010000); // version 1.0
  dv.setUint32(8, 1); // numFonts
  dv.setUint32(12, 16); // offset to the font directory
  // Shift the wrapped TTF's table offsets by +16.
  const numTables = dv.getUint16(16 + 4);
  for (let i = 0; i < numTables; i++) {
    const recOff = 16 + 12 + i * 16;
    dv.setUint32(recOff + 8, dv.getUint32(recOff + 8) + 16);
  }
  return out;
}

const ttfPath = resolve(__dirname, "../public/examples/basic/fonts/IPAexGothic.ttf");

describe("ttc", () => {
  it("isTtc detects the ttcf signature", async () => {
    const ttf = new Uint8Array(await readFile(ttfPath));
    expect(isTtc(ttf)).toBe(false);
    expect(isTtc(wrapAsTtc(ttf))).toBe(true);
  });

  it("extracts a standalone SFNT from a TTC that fontkit can read", async () => {
    const ttf = new Uint8Array(await readFile(ttfPath));
    const ttc = wrapAsTtc(ttf);
    const extracted = extractFontFromTtc(ttc, 0);

    expect(isTtc(extracted)).toBe(false); // no longer a TTC
    // sfntVersion matches the original TTF (glyf TrueType = 0x00010000).
    expect(new DataView(extracted.buffer).getUint32(0)).toBe(
      new DataView(ttf.buffer, ttf.byteOffset).getUint32(0),
    );

    expect(measure(extracted, "あ")).toBeGreaterThan(0);
  });

  it("out-of-range index throws", async () => {
    const ttc = wrapAsTtc(new Uint8Array(await readFile(ttfPath)));
    expect(() => extractFontFromTtc(ttc, 5)).toThrow();
  });

  // If a real TTC (NotoSansCJK) is present, verify extracting multiple fonts.
  const notoTtc = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
  it.skipIf(!existsSync(notoTtc))("extracts multiple fonts from a real TTC", async () => {
    const bytes = new Uint8Array(await readFile(notoTtc));
    expect(isTtc(bytes)).toBe(true);
    expect(measure(extractFontFromTtc(bytes, 0), "漢字")).toBeGreaterThan(0);
    expect(measure(extractFontFromTtc(bytes, 1), "漢字")).toBeGreaterThan(0);
  });
});
