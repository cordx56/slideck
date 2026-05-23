// Handles inline math ($...$) within text.
// Variable expansion uses ${...}, so it does not collide with $x$.

export interface MathSegment {
  math: boolean;
  value: string; // text part as-is, math part is the inner TeX
}

const INLINE_RE = /\$([^$]+)\$/g;

export function hasInlineMath(text: string): boolean {
  return /\$[^$]+\$/.test(text);
}

// Split text into text / math segments.
export function parseInlineMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) segments.push({ math: false, value: text.slice(last, m.index) });
    segments.push({ math: true, value: m[1] });
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) segments.push({ math: false, value: text.slice(last) });
  return segments;
}

// Plain text with the $ delimiters removed (for PDF fallback / height calc).
export function stripInlineMath(text: string): string {
  return parseInlineMath(text)
    .map((s) => s.value)
    .join("");
}
