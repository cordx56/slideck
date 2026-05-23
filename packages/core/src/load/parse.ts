import { parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { PipelineError, joinPath } from "../lib/error";

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
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
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
    const offset = offsetForPath(doc, iss.path);
    const where = iss.path.length > 0 ? ` at ${joinPath(iss.path)}` : "";
    return new PipelineError(`${label}: ${iss.message}${where}`, {
      path: iss.path,
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
