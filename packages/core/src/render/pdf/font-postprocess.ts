// Post-process a saved PDF's font subset streams to inject a minimal cmap.
//
// pdf-lib's subset:true output omits the cmap table because PDF rendering of
// a CIDFontType2 doesn't strictly need it -- the CID-to-GID translation
// happens via CIDToGIDMap in the PDF, not via the font's cmap. macOS Preview
// (Core Graphics) rejects cmap-less sfnt blobs anyway, falls back to system
// fonts, and renders garbled ASCII. See ttf-cmap.ts for the deeper write-up.
//
// External injection: we load the saved PDF, walk every PDFRawStream, and
// when one starts with the TrueType signature ("\x00\x01\x00\x00" or "true"),
// run ensureCmap over it and replace the stream content. No pdf-lib internals
// are touched; the embedder is left alone and the BaseFont / CIDToGIDMap /
// ToUnicode entries it generated all continue to apply. Cost is one extra
// PDF load/save cycle.

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { ensureCmap } from "./ttf-cmap";

// Return either the input bytes (when no fixes are needed -- saves the second
// serialisation) or a freshly saved PDF with patched streams. Two passes:
//   - TTF FontFile2 streams: add a minimal cmap (see ttf-cmap.ts).
//   - CIDFontType0 dicts: strip /CIDToGIDMap, which pdf-lib emits on every
//     descendant CIDFont but which PDF 1.7 Table 117 reserves for Type 2
//     (TrueType) only. macOS Preview is strict about Type 0 (CFF) dicts and
//     rejects them when the entry is present, falling back to a system font
//     and rendering subset CIDs 1..N as the fallback's first N glyphs.
export async function injectFontCmaps(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  let changed = false;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      if (patchFontFile2Cmap(doc, ref, obj)) changed = true;
    } else if (obj instanceof PDFDict) {
      if (stripCidToGidMapFromCidType0(obj)) changed = true;
    }
  }

  if (!changed) return bytes;
  return await doc.save();
}

// Add a cmap to an embedded TrueType subset if it's missing one. Returns true
// when the stream was replaced.
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

  // Re-encode with FlateDecode (pdf-lib's default for new streams). Length1
  // is the uncompressed sfnt size; PDF 9.9 requires it for FontFile2 but
  // pdf-lib's embedder omits it.
  const newStream = doc.context.flateStream(fixed, { Length1: fixed.length });
  copyExtraEntries(obj, newStream);
  doc.context.assign(ref, newStream);
  return true;
}

// Remove /CIDToGIDMap from CIDFontType0 dicts (CFF-backed descendant CIDFonts).
// pdf-lib unconditionally writes "/CIDToGIDMap /Identity" on every descendant
// CIDFont it embeds; the entry is fine on CIDFontType2 (TrueType) but spec-
// invalid on CIDFontType0 (CFF, which routes CID->glyph through the CFF's own
// charset/CharStrings instead). Returns true when the dict was modified.
function stripCidToGidMapFromCidType0(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("Type"))?.toString() !== "/Font") return false;
  if (dict.lookup(PDFName.of("Subtype"))?.toString() !== "/CIDFontType0") return false;
  if (!dict.has(PDFName.of("CIDToGIDMap"))) return false;
  dict.delete(PDFName.of("CIDToGIDMap"));
  return true;
}

function isTrueType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // Standard sfnt scaler (TTF/OTF outline) is 0x00010000; Apple uses "true"
  // for legacy TrueType. Either one indicates a TrueType font program.
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return true;
  return false;
}

// Copy any dict entries from the original stream (other than the ones the
// replacement already sets: Length, Length1, Filter) so we don't lose
// implementation-specific keys. PDFFile2 streams typically only carry
// /Length, /Filter, /Length1 -- but defensive copy is cheap insurance.
function copyExtraEntries(src: PDFRawStream, dst: PDFRawStream): void {
  const skip = new Set(["Length", "Length1", "Filter"]);
  for (const [key, value] of src.dict.entries()) {
    const name = key.asString().slice(1); // strip the leading "/"
    if (skip.has(name)) continue;
    dst.dict.set(PDFName.of(name), value);
  }
}
