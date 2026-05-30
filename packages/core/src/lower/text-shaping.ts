import type { Align } from "../ir/hir";
import { type FontMetrics, isCJK } from "./metrics";

export interface ShapedLine {
  text: string;
  x: number; // x offset from box left edge (after align)
  baseline: number; // baseline y from box top edge
  width: number;
}

export interface ShapedText {
  lines: ShapedLine[];
  width: number; // max line width
  height: number; // total height
}

type TokenKind = "word" | "space" | "cjk";
interface Token {
  text: string;
  kind: TokenKind;
}

// Break a paragraph into a token sequence.
// Runs of alphanumerics are words (break at space boundaries), CJK is per-character
// (break anywhere), and consecutive whitespace is merged into one space token.
function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  let word = "";
  const flush = () => {
    if (word) {
      tokens.push({ text: word, kind: "word" });
      word = "";
    }
  };
  let space = "";
  const flushSpace = () => {
    if (space) {
      tokens.push({ text: space, kind: "space" });
      space = "";
    }
  };

  for (const ch of paragraph) {
    const code = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) {
      flush();
      space += ch;
      continue;
    }
    flushSpace();
    if (isCJK(code)) {
      flush();
      tokens.push({ text: ch, kind: "cjk" });
    } else {
      word += ch;
    }
  }
  flush();
  flushSpace();
  return tokens;
}

// Greedily split a paragraph into visual lines that fit within maxWidth.
function wrapParagraph(
  paragraph: string,
  font: string,
  size: number,
  maxWidth: number,
  letterSpacing: number,
  metrics: FontMetrics,
): string[] {
  if (paragraph === "") return [""];
  const limit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Infinity;
  const tokens = tokenize(paragraph);

  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  // First line keeps a leading-space token (the user typed it after a hard \n
  // or at start-of-text -- indent matters). Wrap-induced lines drop their
  // leading space so the prev line's trailing space doesn't bleed in.
  let openedByWrap = false;
  const tokenW = (t: Token) =>
    metrics.measure(t.text, font, size) + letterSpacing * [...t.text].length;

  for (const t of tokens) {
    const w = tokenW(t);
    if (line !== "" && lineW + w > limit && t.kind !== "space") {
      lines.push(line.replace(/\s+$/, ""));
      line = "";
      lineW = 0;
      openedByWrap = true;
    }
    if (line === "" && t.kind === "space" && openedByWrap) continue;
    line += t.text;
    lineW += w;
  }
  lines.push(line.replace(/\s+$/, ""));
  return lines;
}

// Shape text into lines. The single wrapping routine shared by SVG/PDF.
export function shapeText(
  text: string,
  font: string,
  size: number,
  maxWidth: number,
  align: Align,
  lineHeight: number,
  letterSpacing: number,
  metrics: FontMetrics,
): ShapedText {
  const paragraphs = text.split("\n");
  const rawLines: string[] = [];
  for (const p of paragraphs) {
    rawLines.push(...wrapParagraph(p, font, size, maxWidth, letterSpacing, metrics));
  }

  const lineBox = size * lineHeight;
  const ascent = size * metrics.ascentRatio(font);
  const boxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;

  let maxLineW = 0;
  const lines: ShapedLine[] = rawLines.map((lineText, i) => {
    const w =
      metrics.measure(lineText, font, size) + letterSpacing * Math.max(0, [...lineText].length - 1);
    maxLineW = Math.max(maxLineW, w);
    const ref = boxWidth || w;
    let x = 0;
    if (align === "center") x = (ref - w) / 2;
    else if (align === "right") x = ref - w;
    return { text: lineText, x, baseline: i * lineBox + ascent, width: w };
  });

  return {
    lines,
    width: boxWidth || maxLineW,
    height: rawLines.length * lineBox,
  };
}
