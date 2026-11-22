import fontMetricsData from "katex/src/fontMetricsData.js";

// KaTeX's own character metric table (not part of its public API; the
// dependency is pinned exactly). Keyed by KaTeX font name ("Math-Italic") and
// code point; each tuple is [depth, height, italic, skew, width] in em.
type MetricTable = Partial<Record<string, Partial<Record<number, readonly number[]>>>>;

const METRICS: MetricTable = fontMetricsData;
const WIDTH = 4;
// KaTeX substitutes the metrics of "M" for characters its fonts do not cover.
const FALLBACK_CODE_POINT = 77;

/** Advance width in em of one character set in the KaTeX font `font`. */
export function katexCharWidth(char: string, font: string): number {
  const table = METRICS[font];
  const metrics =
    table?.[char.codePointAt(0) ?? FALLBACK_CODE_POINT] ?? table?.[FALLBACK_CODE_POINT];
  return metrics?.[WIDTH] ?? 0;
}
