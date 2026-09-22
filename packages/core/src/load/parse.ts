import { parseDocument, isSeq, type Document } from "yaml";
import type { z } from "zod";
import { PipelineError, formatIssuePath } from "../lib/error";

export interface ParseOutput<T> {
  value?: T;
  // Validation/syntax errors. If empty, value is valid.
  errors: PipelineError[];
  // Keep the original Document for position mapping.
  doc: Document;
}

// Parse YAML text and validate it against the given zod schema.
// For both YAML syntax errors and zod errors, attach the source text offset when possible.
export function parseAndValidate<T>(
  text: string,
  schema: z.ZodType<T>,
  label = "document",
): ParseOutput<T> {
  const doc = parseDocument(text, { keepSourceTokens: true });

  if (doc.errors.length > 0) {
    return {
      doc,
      errors: doc.errors.map(
        (e) =>
          new PipelineError(`YAML syntax error (${label}): ${e.message}`, {
            offset: [e.pos[0], e.pos[1]],
          }),
      ),
    };
  }

  const json = doc.toJS({ maxAliasCount: -1 });
  const result = schema.safeParse(json);
  if (result.success) {
    return { doc, value: result.data, errors: [] };
  }

  const errors = result.error.issues.map((iss) => {
    // zod 4 types path as PropertyKey[]; YAML-derived paths never contain symbols.
    const path = iss.path as (string | number)[];
    const offset = offsetForPath(doc, path);
    const where = path.length > 0 ? ` at ${formatIssuePath(path)}` : "";
    return new PipelineError(`${label}: ${iss.message}${where}`, {
      path,
      offset,
    });
  });
  return { doc, errors };
}

// Look up the YAML node range (text offset) from a zod path.
export function offsetForPath(
  doc: Document,
  path: (string | number)[],
): [number, number] | undefined {
  // If the node is not found, fall back toward the parent.
  for (let i = path.length; i >= 0; i--) {
    const sub = path.slice(0, i);
    const node = sub.length === 0 ? doc.contents : doc.getIn(sub, true);
    const range = (node as { range?: [number, number, number] } | null)?.range;
    if (range) return [range[0], range[1]];
  }
  return undefined;
}

// Source offsets [start, end) of every entry in a deck's slides: array.
// Used by the editor for bidirectional cursor <-> slide-preview sync. The
// `end` of each range is the offset of the next slide so the union covers
// every character between the slides: marker and the document tail -- so
// any cursor position past the first slide resolves to *some* slide.
// Returns [] when the YAML is unparseable or has no slides: array.
export function slideRangesOf(text: string): Array<[number, number]> {
  let doc: Document;
  try {
    doc = parseDocument(text, { keepSourceTokens: true });
  } catch {
    return [];
  }
  if (doc.errors.length > 0) return [];
  const slides = doc.get("slides", true);
  if (!isSeq(slides)) return [];

  // Each item has a [start, end-of-value, end-of-node] range. Use end-of-node
  // so trailing comments on the same item stay with it, then stretch the
  // range to the start of the next item so gaps between dash-prefixed entries
  // (blank lines, indent comments) don't fall into "no slide".
  const ranges: Array<[number, number]> = [];
  const items = slides.items as Array<{ range?: [number, number, number] }>;
  for (const item of items) {
    if (item?.range) ranges.push([item.range[0], item.range[2]]);
  }
  for (let i = 0; i < ranges.length - 1; i++) {
    ranges[i][1] = ranges[i + 1][0];
  }
  // Stretch the last slide to cover the rest of the document.
  if (ranges.length > 0) ranges[ranges.length - 1][1] = text.length;
  return ranges;
}
