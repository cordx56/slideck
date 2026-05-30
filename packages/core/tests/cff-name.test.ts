import { describe, it, expect } from "vitest";
import { readCffName } from "../src/render/pdf/cff-name";

describe("readCffName", () => {
  // Build a minimal raw-CFF blob whose Name INDEX has one entry. CFF Name
  // INDEX format: count u16, offSize u8, offsets[count+1] (each `offSize`
  // bytes, 1-based), then the concatenated name bytes. We don't include any
  // of the other CFF sub-tables -- readCffName only needs the header + Name
  // INDEX, so anything after that is ignored.
  function rawCff(name: string): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const total = 4 /*hdr*/ + 2 + 1 + 2 + nameBytes.length;
    const out = new Uint8Array(total);
    // CFF header
    out[0] = 1; // major
    out[1] = 0; // minor
    out[2] = 4; // header size (we set p=4 after this)
    out[3] = 1; // offSize (irrelevant past header but well-formed)
    // Name INDEX
    let p = 4;
    out[p++] = 0;
    out[p++] = 1; // count = 1
    out[p++] = 1; // offSize = 1
    out[p++] = 1; // offsets[0] = 1 (1-based start)
    out[p++] = 1 + nameBytes.length; // offsets[1] = past the last byte
    out.set(nameBytes, p);
    return out;
  }

  it("reads the first entry of a raw CFF Name INDEX", () => {
    expect(readCffName(rawCff("HiraKakuStdN-W7"))).toBe("HiraKakuStdN-W7");
  });

  it("reads the CFF Name inside an OTTO sfnt wrapper", () => {
    // Build a minimal OTTO sfnt with one table whose tag is "CFF " and whose
    // bytes are a valid raw-CFF blob. Other sfnt tables aren't referenced by
    // the reader so we only need this one.
    const cff = rawCff("HiraKakuProN-W2");
    const numTables = 1;
    const headerSize = 12 + numTables * 16;
    const dataOff = (headerSize + 3) & ~3;
    const total = dataOff + cff.length;
    const otto = new Uint8Array(total);
    // sfnt scaler "OTTO"
    otto.set([0x4f, 0x54, 0x54, 0x4f], 0);
    const dv = new DataView(otto.buffer);
    dv.setUint16(4, numTables);
    // Table record: tag "CFF " (note trailing space), checksum 0, offset, length
    const recOff = 12;
    otto.set([0x43, 0x46, 0x46, 0x20], recOff); // "CFF "
    dv.setUint32(recOff + 4, 0); // checksum (ignored by reader)
    dv.setUint32(recOff + 8, dataOff);
    dv.setUint32(recOff + 12, cff.length);
    otto.set(cff, dataOff);
    expect(readCffName(otto)).toBe("HiraKakuProN-W2");
  });

  it("returns undefined for a TrueType outline font (no CFF table)", () => {
    // Bare sfnt header with scaler 0x00010000 (TrueType). Reader sees the
    // header but neither "OTTO" nor "ttcf" matches and bails out.
    const ttf = new Uint8Array(12);
    ttf.set([0x00, 0x01, 0x00, 0x00], 0);
    expect(readCffName(ttf)).toBeUndefined();
  });

  it("returns undefined for unrecognised input", () => {
    expect(readCffName(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeUndefined();
    expect(readCffName(new Uint8Array(2))).toBeUndefined();
  });
});
