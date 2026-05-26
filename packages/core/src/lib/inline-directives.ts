// Generic inline directive: ?[content](k=v, k=v, ...).
//
// content may contain markdown, inline math, and further directives -- the
// scanner tracks bracket depth so a nested directive's "]" does not close the
// outer one. Backslash escapes the next character ("\\]" / "\\)" / "\\\\").
//
// Attributes are key=value pairs separated by commas; unknown keys are kept
// in the parsed map but otherwise ignored, so new attributes (bg / size /
// weight / family / ...) can be wired in later without changing the parser.

export interface DirectiveSegment {
  directive: true;
  content: string;
  attrs: Record<string, string>;
}
export interface PlainSegment {
  directive: false;
  value: string;
}
export type InlineSplit = DirectiveSegment | PlainSegment;

// Cheap pre-check: any "?[" is enough to suspect a directive.
export function hasInlineDirective(text: string): boolean {
  return text.includes("?[");
}

export function parseInlineDirectives(text: string): InlineSplit[] {
  const out: InlineSplit[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("?[", i);
    if (start < 0) {
      if (i < text.length) out.push({ directive: false, value: text.slice(i) });
      return out;
    }
    // Find the matching closing "]" by bracket depth (starting at 1 for "?[").
    let j = start + 2;
    let depth = 1;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "\\" && j + 1 < text.length) {
        j += 2;
        continue;
      }
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    // A valid directive requires the closing "]" followed immediately by "(".
    if (depth !== 0 || text[j + 1] !== "(") {
      // Not a directive -- emit just the "?" as plain text and let the
      // ordinary markdown link "[text](url)" handling pick up "[...](...)".
      out.push({ directive: false, value: text.slice(i, start + 1) });
      i = start + 1;
      continue;
    }
    // Find the closing ")".
    let k = j + 2;
    while (k < text.length) {
      if (text[k] === "\\" && k + 1 < text.length) {
        k += 2;
        continue;
      }
      if (text[k] === ")") break;
      k++;
    }
    if (k >= text.length) {
      out.push({ directive: false, value: text.slice(i, start + 1) });
      i = start + 1;
      continue;
    }
    if (start > i) out.push({ directive: false, value: text.slice(i, start) });
    const content = unescape(text.slice(start + 2, j));
    const attrs = parseAttrs(text.slice(j + 2, k));
    out.push({ directive: true, content, attrs });
    i = k + 1;
  }
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of splitTopLevelComma(s)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    if (!key) continue;
    out[key] = unescape(pair.slice(eq + 1).trim());
  }
  return out;
}

// Split on commas, respecting backslash escapes ("\\," is one literal char).
function splitTopLevelComma(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (s[i] === ",") {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}
