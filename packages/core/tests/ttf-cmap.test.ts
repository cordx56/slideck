import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { ensureCmap, buildMinimalCmap, MINIMAL_CMAP_LENGTH } from "../src/render/pdf/ttf-cmap";
import { parseFont, addTable, tableChecksum } from "../src/render/pdf/ttf-tables";

// The example deck's Noto Serif Regular is a real-world TTF with all the
// usual tables; we drop ones to simulate the cmap-less subset pdf-lib emits.
const NOTO_PATH = resolve(
  __dirname,
  "../../web/public/examples/basic/fonts/NotoSerif-Regular.ttf",
);

// fontkit handles the .create reflection we need; cast to a typed view of the
// subset we touch (postscriptName, numGlyphs).
type FK = { create: (b: Uint8Array) => { postscriptName: string; numGlyphs: number } };
const fk = fontkit as unknown as FK;

describe("ttf-tables.tableChecksum", () => {
  it("sums uint32 big-endian over zero-padded data", () => {
    // Two big-endian uint32: 0x00010203 + 0x04050607 = 0x0406080A
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(tableChecksum(data)).toBe(0x0406080a);
  });

  it("pads trailing partial uint32 with zeros on the right", () => {
    // Three bytes: 0x010203 -> padded to 0x01020300
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    expect(tableChecksum(data)).toBe(0x01020300);
  });
});

describe("ttf-cmap.buildMinimalCmap", () => {
  it("is the documented byte length and a valid Format 4 subtable", () => {
    const bytes = buildMinimalCmap();
    expect(bytes.length).toBe(MINIMAL_CMAP_LENGTH);
    const dv = new DataView(bytes.buffer);
    // table header: version=0, numTables=1
    expect(dv.getUint16(0)).toBe(0);
    expect(dv.getUint16(2)).toBe(1);
    // encoding record: platform=3 (Microsoft), encoding=1 (Unicode BMP)
    expect(dv.getUint16(4)).toBe(3);
    expect(dv.getUint16(6)).toBe(1);
    // subtable starts at offset stored in the record
    const subOff = dv.getUint32(8);
    expect(dv.getUint16(subOff)).toBe(4); // format
    expect(dv.getUint16(subOff + 2)).toBe(24); // subtable length
  });
});

describe("ttf-cmap.ensureCmap", () => {
  // Strip the cmap from a real font to mimic pdf-lib's subset output, then
  // make sure ensureCmap puts it back and the font round-trips through
  // fontkit (which is itself strict about sfnt structure).
  it("adds a cmap when one is missing and the result is loadable", () => {
    const orig = new Uint8Array(readFileSync(NOTO_PATH));
    const stripped = stripTable(orig, "cmap");
    // Sanity: the stripped font has no cmap.
    expect(parseFont(stripped).entries.some((e) => e.tag === "cmap")).toBe(false);

    const patched = ensureCmap(stripped);
    const entries = parseFont(patched).entries;
    const cmap = entries.find((e) => e.tag === "cmap");
    expect(cmap).toBeDefined();
    expect(cmap!.length).toBe(MINIMAL_CMAP_LENGTH);

    // Loadable: fontkit reparses every table and verifies the head magic.
    const reloaded = fk.create(patched);
    expect(reloaded.numGlyphs).toBe(fk.create(orig).numGlyphs);
  });

  it("is a no-op when the font already has a cmap (returns same bytes)", () => {
    const orig = new Uint8Array(readFileSync(NOTO_PATH));
    const result = ensureCmap(orig);
    // Same reference, not just same content -- callers use that to skip
    // rewriting unchanged FontFile2 streams.
    expect(result).toBe(orig);
  });

  it("recomputes head.checkSumAdjustment to match the new layout", () => {
    const orig = new Uint8Array(readFileSync(NOTO_PATH));
    const stripped = stripTable(orig, "cmap");
    const patched = ensureCmap(stripped);
    const head = parseFont(patched).entries.find((e) => e.tag === "head")!;
    const dv = new DataView(patched.buffer, patched.byteOffset);
    // OpenType: 0xB1B0AFBA = sum-of-all-uint32 (with adjustment=0) + adjustment.
    // Zero the adjustment, sum the font, and verify the stored adjustment closes
    // the equation.
    const stored = dv.getUint32(head.offset + 8);
    dv.setUint32(head.offset + 8, 0);
    const sum = tableChecksum(patched);
    expect((sum + stored) >>> 0).toBe(0xb1b0afba);
    dv.setUint32(head.offset + 8, stored); // restore -- we only borrowed
  });
});

// Remove one table from a font (used by tests to simulate pdf-lib's subset).
function stripTable(ttf: Uint8Array, tag: string): Uint8Array {
  const parsed = parseFont(ttf);
  const keep = parsed.entries.filter((e) => e.tag !== tag);
  // Easiest path: rebuild by re-adding each kept table to an empty header. The
  // addTable helper does the layout/checksum legwork; iterating it preserves
  // the sort. Start from a "font" containing just .notdef-less placeholder...
  // simpler: synthesise a tiny base font and add each table back. Even simpler:
  // build the directory by hand here.
  const headerSize = 12 + keep.length * 16;
  let cursor = (headerSize + 3) & ~3;
  const layout = keep.map((e) => {
    const off = cursor;
    cursor += (e.length + 3) & ~3;
    return { ...e, offset: off };
  });
  const total = cursor;
  const out = new Uint8Array(total);
  out.set(parsed.scaler, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, layout.length);
  const es = Math.floor(Math.log2(layout.length));
  dv.setUint16(6, (1 << es) * 16);
  dv.setUint16(8, es);
  dv.setUint16(10, layout.length * 16 - (1 << es) * 16);
  for (let i = 0; i < layout.length; i++) {
    const e = layout[i];
    const off = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[off + k] = e.tag.charCodeAt(k);
    dv.setUint32(off + 4, e.checksum);
    dv.setUint32(off + 8, e.offset);
    dv.setUint32(off + 12, e.length);
  }
  for (let i = 0; i < layout.length; i++) {
    const src = parsed.entries.find((e) => e.tag === layout[i].tag)!;
    out.set(ttf.subarray(src.offset, src.offset + src.length), layout[i].offset);
  }
  // Re-close the head checksum so the stripped font is itself valid (the test
  // helper shouldn't hand a broken input to ensureCmap).
  const head = layout.find((e) => e.tag === "head");
  if (head) {
    dv.setUint32(head.offset + 8, 0);
    const sum = tableChecksum(out);
    dv.setUint32(head.offset + 8, (0xb1b0afba - sum) >>> 0);
  }
  // Suppress unused-import warning when addTable not referenced from helper.
  void addTable;
  return out;
}
