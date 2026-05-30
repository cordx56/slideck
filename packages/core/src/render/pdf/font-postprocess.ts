// Post-process a saved PDF's font streams for macOS Preview compatibility.
//
// Three independent patches, all reacting to spec violations or omissions
// pdf-lib's font embedder ships:
//
//   1. TTF (FontFile2) subsets are missing the cmap table -- Preview's sfnt
//      loader rejects them and falls back to a system font. ensureCmap adds
//      a minimal Format 4 cmap (see ttf-cmap.ts).
//
//   2. CIDFontType0 (CFF descendant) dicts carry "/CIDToGIDMap /Identity"
//      even though PDF 1.7 Table 117 reserves that entry for CIDFontType2.
//      Preview rejects the dict and falls back. Strip the entry.
//
//   3. CFF (FontFile3 /CIDFontType0C) streams hold a *raw* CFF blob. PDF
//      allows it but Preview's CoreText loader only handles sfnt-wrapped
//      CFF. wrapCffInOpenType builds an OpenType (OTTO) sfnt around the
//      CFF subset; the stream becomes /Subtype /OpenType and the descendant
//      CIDFont keeps /Subtype /CIDFontType0 (still CFF-flavoured per spec).
//
// None of the patches touch pdf-lib internals: we just load the saved PDF,
// walk indirect objects, and edit dicts/streams. Cost is one extra PDF
// load/save cycle.

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { ensureCmap } from "./ttf-cmap";
import { wrapCffInOpenType } from "./ot-wrap";

// Return either the input bytes (when no fixes are needed -- saves the second
// serialisation) or a freshly saved PDF with patched streams.
export async function injectFontCmaps(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  let changed = false;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      if (patchFontFile2Cmap(doc, ref, obj)) changed = true;
      else if (patchFontFile3Cff(doc, ref, obj)) changed = true;
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

// Detect a FontFile3 stream whose contents are a raw CFF blob (header
// "01 00 ...") and re-wrap it in an OpenType (OTTO) sfnt. The stream's
// /Subtype is updated from /CIDFontType0C to /OpenType to match. Returns
// true on replacement, false when the stream is not a raw CFF.
//
// We key off the actual bytes (CFF major version 1 + minor 0 + reasonable
// header size) rather than the dict's /Subtype -- the latter is what we'll
// rewrite, so trusting the bytes themselves is safer.
function patchFontFile3Cff(
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
  if (!isRawCff(decoded)) return false;

  const wrapped = wrapCffInOpenType(decoded);
  // Build the replacement with /Subtype /OpenType (overrides the original
  // /CIDFontType0C). /Length1 is the uncompressed sfnt size; spec-compliant
  // for FontFile3 OpenType too.
  const newStream = doc.context.flateStream(wrapped, {
    Length1: wrapped.length,
    Subtype: "OpenType",
  });
  // Preserve any other custom dict entries the embedder may have added.
  copyExtraEntries(obj, newStream, new Set(["Length", "Length1", "Filter", "Subtype"]));
  doc.context.assign(ref, newStream);
  return true;
}

function isRawCff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // CFF major=1, minor=0 (the only CFF version pdf-lib's subsetter outputs).
  // We don't accept CFF2 (major=2) because pdf-lib doesn't produce it and the
  // wrapping needs different OT-table choices.
  return bytes[0] === 0x01 && bytes[1] === 0x00;
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

// Copy any dict entries from the original stream into the replacement,
// skipping the keys the new stream already sets. Defensive against any
// implementation-specific entries pdf-lib may add in future versions.
function copyExtraEntries(
  src: PDFRawStream,
  dst: PDFRawStream,
  skip = new Set(["Length", "Length1", "Filter"]),
): void {
  for (const [key, value] of src.dict.entries()) {
    const name = key.asString().slice(1); // strip the leading "/"
    if (skip.has(name)) continue;
    dst.dict.set(PDFName.of(name), value);
  }
}
