// Post-process a saved PDF to work around bugs in pdf-lib's font embedder.
//
// The essential fix is (3) below -- without it, macOS Preview / CoreText /
// FreeType / poppler all reject the embedded font and fall back to a system
// font, which renders subset CIDs 1..N as that system font's first N glyphs
// (the "+,-./0123..." consecutive-ASCII garble pattern). (1) and (2) are
// spec-correctness cleanups that don't change rendering on lenient readers
// but stop a strict reader from getting confused before it ever loads the
// font program.
//
//   1. TTF FontFile2 streams: pdf-lib's subsetter strips cmap from the
//      output. The PDF spec lets CIDFontType2 dispense with cmap (the
//      CIDToGIDMap maps CID -> GID directly), but macOS Preview's sfnt
//      loader doesn't, so we inject a minimal Format 4 cmap.
//      See ttf-cmap.ts.
//
//   2. CIDFontType0 dicts: pdf-lib unconditionally writes /CIDToGIDMap
//      /Identity on every descendant CIDFont, but PDF 1.7 Table 117
//      reserves that entry for CIDFontType2 (TrueType) only. Strip it
//      from the Type 0 (CFF) dicts.
//
//   3. CFF (FontFile3 /CIDFontType0C) streams: pdf-lib writes an
//      out-of-range value (e.g. 31) into the CFF header's OffSize byte
//      (byte 3). CFF spec section 6 requires 1..4 -- it sizes an optional
//      post-header offset array. Browsers ignore the byte and parse fine;
//      strict CFF parsers (CoreText, FreeType) reject the font. Clamp the
//      byte to 4 (max legal value); pdf-lib's subset doesn't emit the
//      post-header array (hdrSize stays at 4) so the value isn't otherwise
//      consulted -- it just has to be in range.
//
// None of the patches touch pdf-lib internals; we load the saved PDF, walk
// indirect objects, and edit dicts/streams. Cost is one extra PDF
// load/save cycle.

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { ensureCmap } from "./ttf-cmap";

// Returns the input bytes when no fixes were needed (saves the second
// serialisation), otherwise a freshly saved PDF.
export async function injectFontCmaps(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  let changed = false;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      if (patchFontFile2Cmap(doc, ref, obj)) changed = true;
      else if (patchCffOffSize(doc, ref, obj)) changed = true;
    } else if (obj instanceof PDFDict) {
      if (stripCidToGidMapFromCidType0(obj)) changed = true;
    }
  }

  if (!changed) return bytes;
  return await doc.save();
}

// (1) TTF subsets: add a minimal cmap to embedded TrueType fonts that lack
// one. Returns true when the stream was replaced.
function patchFontFile2Cmap(
  doc: PDFDocument,
  ref: import("pdf-lib").PDFRef,
  obj: PDFRawStream,
): boolean {
  let decoded: Uint8Array;
  try {
    decoded = decodePDFRawStream(obj).decode();
  } catch {
    return false;
  }
  if (!isTrueType(decoded)) return false;
  const fixed = ensureCmap(decoded);
  if (fixed === decoded) return false;
  // Re-encode with FlateDecode. /Length1 is the uncompressed sfnt size --
  // PDF 9.9 requires it for FontFile2, and pdf-lib's embedder omits it.
  const newStream = doc.context.flateStream(fixed, { Length1: fixed.length });
  copyExtraEntries(obj, newStream);
  doc.context.assign(ref, newStream);
  return true;
}

// (3) CFF subsets: patch the CFF header's OffSize byte when it's out of the
// spec-legal 1..4 range. Returns true when the stream was rewritten.
//
// pdf-lib emits raw CFF blobs (header "01 00 ...") for /Subtype
// /CIDFontType0C streams. The 4th byte (OffSize) is supposed to size an
// optional post-header offset array; fontkit's CFFSubset writes whatever
// happened to be in the backing buffer at that position. CoreText /
// FreeType validate the value and reject the font when it's >4.
function patchCffOffSize(
  doc: PDFDocument,
  ref: import("pdf-lib").PDFRef,
  obj: PDFRawStream,
): boolean {
  let decoded: Uint8Array;
  try {
    decoded = decodePDFRawStream(obj).decode();
  } catch {
    return false;
  }
  // Raw CFF magic: major=1, minor=0 (the only CFF version pdf-lib's subsetter
  // outputs). CFF2 (major=2) and OTTO-wrapped CFF are not produced by it.
  if (decoded.length < 4 || decoded[0] !== 0x01 || decoded[1] !== 0x00) return false;
  if (decoded[3] >= 1 && decoded[3] <= 4) return false; // already valid
  const fixed = new Uint8Array(decoded);
  fixed[3] = 4;
  const newStream = doc.context.flateStream(fixed, {});
  copyExtraEntries(obj, newStream);
  doc.context.assign(ref, newStream);
  return true;
}

// (2) Remove /CIDToGIDMap from CIDFontType0 dicts. pdf-lib emits the entry
// on every descendant CIDFont, but the spec restricts it to Type 2 (TrueType).
function stripCidToGidMapFromCidType0(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("Type"))?.toString() !== "/Font") return false;
  if (dict.lookup(PDFName.of("Subtype"))?.toString() !== "/CIDFontType0") return false;
  if (!dict.has(PDFName.of("CIDToGIDMap"))) return false;
  dict.delete(PDFName.of("CIDToGIDMap"));
  return true;
}

function isTrueType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // Standard sfnt scaler 0x00010000, or Apple's legacy "true".
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return true;
  return false;
}

// Copy dict entries from the original stream into the replacement, skipping
// the keys the new stream already sets. FontFile streams usually only carry
// /Length, /Filter, /Length1 -- defensive copy is cheap insurance against
// future pdf-lib changes.
function copyExtraEntries(src: PDFRawStream, dst: PDFRawStream): void {
  const skip = new Set(["Length", "Length1", "Filter"]);
  for (const [key, value] of src.dict.entries()) {
    const name = key.asString().slice(1); // strip the leading "/"
    if (skip.has(name)) continue;
    dst.dict.set(PDFName.of(name), value);
  }
}
