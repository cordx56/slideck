import type { Align, RichStyle } from "../ir/hir";
import type { FontRef } from "../ir/lir";
import { type FontMetrics, isCJK } from "./metrics";
import { parseRich, type RichSegment } from "../lib/richtext";
import { renderMath, type MathGlyph } from "../lib/math";

// Lower rich text (inline markdown + math) into placed run / math sequences.
// A mixed variant of shapeText. Coords use box top-left origin (x=left, baseline=y from top).

export interface RichRun {
  text: string;
  x: number; // run left edge
  baseline: number; // baseline y
  width: number;
  font: FontRef;
  size: number;
  color: string;
  underline: boolean;
  strike: boolean;
  href?: string; // link target (for PDF/SVG click region)
}

export interface RichMathPlaced {
  glyphs: MathGlyph[]; // baseline origin (used after translate)
  x: number;
  baseline: number;
}

export interface RichLayout {
  runs: RichRun[];
  maths: RichMathPlaced[];
  height: number;
}

interface Style {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  link: boolean;
  href?: string;
}

type Atom =
  | { kind: "text"; text: string; style: Style; w: number; space: boolean }
  | { kind: "break" }
  | { kind: "math"; glyphs: MathGlyph[]; w: number };

const sameStyle = (a: Style, b: Style): boolean =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.code === b.code &&
  a.strike === b.strike &&
  a.link === b.link &&
  a.href === b.href;

function fontFor(style: Style, baseFont: string, rich: RichStyle): string {
  return style.code ? rich.monoFamily : baseFont;
}

function pushText(
  atoms: Atom[],
  text: string,
  style: Style,
  baseFont: string,
  size: number,
  ls: number,
  metrics: FontMetrics,
  rich: RichStyle,
): void {
  const font = fontFor(style, baseFont, rich);
  const measure = (s: string): number => metrics.measure(s, font, size) + ls * [...s].length;
  let word = "";
  const flushWord = (): void => {
    if (word) {
      atoms.push({ kind: "text", text: word, style, w: measure(word), space: false });
      word = "";
    }
  };
  let space = "";
  const flushSpace = (): void => {
    if (space) {
      atoms.push({ kind: "text", text: space, style, w: measure(space), space: true });
      space = "";
    }
  };
  for (const ch of text) {
    if (ch === "\n") {
      flushWord();
      flushSpace();
      atoms.push({ kind: "break" });
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      space += ch;
      continue;
    }
    flushSpace();
    if (isCJK(ch.codePointAt(0) ?? 0)) {
      flushWord();
      atoms.push({ kind: "text", text: ch, style, w: measure(ch), space: false });
    } else {
      word += ch;
    }
  }
  flushWord();
  flushSpace();
}

function buildAtoms(
  segments: RichSegment[],
  baseFont: string,
  size: number,
  ls: number,
  metrics: FontMetrics,
  rich: RichStyle,
): Atom[] {
  const PLAIN: Style = { bold: false, italic: false, code: false, strike: false, link: false };
  const atoms: Atom[] = [];
  for (const seg of segments) {
    if (seg.kind === "math") {
      const m = renderMath(seg.tex, size);
      if (m) atoms.push({ kind: "math", glyphs: m.glyphs, w: m.width });
      else pushText(atoms, seg.tex, PLAIN, baseFont, size, ls, metrics, rich); // raw text on failure
      continue;
    }
    pushText(
      atoms,
      seg.text,
      {
        bold: seg.bold,
        italic: seg.italic,
        code: seg.code,
        strike: seg.strike,
        link: seg.link,
        href: seg.href,
      },
      baseFont,
      size,
      ls,
      metrics,
      rich,
    );
  }
  return atoms;
}

function wrap(atoms: Atom[], maxWidth: number): Atom[][] {
  const limit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Infinity;
  const lines: Atom[][] = [];
  let line: Atom[] = [];
  let w = 0;
  for (const a of atoms) {
    if (a.kind === "break") {
      lines.push(line);
      line = [];
      w = 0;
      continue;
    }
    const isSpace = a.kind === "text" && a.space;
    if (line.length > 0 && w + a.w > limit && !isSpace) {
      lines.push(line);
      line = [];
      w = 0;
    }
    if (line.length === 0 && isSpace) continue; // drop leading space
    line.push(a);
    w += a.w;
  }
  lines.push(line);
  return lines;
}

// Line with trailing spaces removed (for accurate align calc and run width).
function trimTrailing(line: Atom[]): Atom[] {
  let end = line.length;
  while (end > 0) {
    const a = line[end - 1];
    if (a.kind === "text" && a.space) end--;
    else break;
  }
  return line.slice(0, end);
}

export function shapeRich(
  text: string,
  baseFont: string,
  size: number,
  maxWidth: number,
  align: Align,
  lineHeight: number,
  letterSpacing: number,
  metrics: FontMetrics,
  rich: RichStyle,
  color: string,
): RichLayout {
  const atoms = buildAtoms(parseRich(text), baseFont, size, letterSpacing, metrics, rich);
  const lines = wrap(atoms, maxWidth);
  const lineBox = size * lineHeight;
  const ascent = size * metrics.ascentRatio(baseFont);
  const boxW = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;

  const runs: RichRun[] = [];
  const maths: RichMathPlaced[] = [];

  lines.forEach((raw, i) => {
    const line = trimTrailing(raw);
    const baseline = i * lineBox + ascent;
    const lw = line.reduce((s, a) => s + (a.kind === "break" ? 0 : a.w), 0);
    const ref = boxW || lw;
    let x = align === "center" ? (ref - lw) / 2 : align === "right" ? ref - lw : 0;

    let cur: { style: Style; text: string; x: number; w: number } | null = null;
    const flush = (): void => {
      if (!cur) return;
      const s = cur.style;
      runs.push({
        text: cur.text,
        x: cur.x,
        baseline,
        width: cur.w,
        font: {
          family: s.code ? rich.monoFamily : baseFont,
          weight: s.bold ? 700 : undefined,
          style: s.italic ? "italic" : undefined,
        },
        size,
        color: s.link ? rich.linkColor : s.code ? rich.monoColor : color,
        underline: s.link && rich.linkUnderline,
        strike: s.strike,
        href: s.href,
      });
      cur = null;
    };

    for (const a of line) {
      if (a.kind === "math") {
        flush();
        maths.push({ glyphs: a.glyphs, x, baseline });
        x += a.w;
        continue;
      }
      if (a.kind !== "text") continue;
      if (cur && sameStyle(cur.style, a.style)) {
        cur.text += a.text;
        cur.w += a.w;
      } else {
        flush();
        cur = { style: a.style, text: a.text, x, w: a.w };
      }
      x += a.w;
    }
    flush();
  });

  return { runs, maths, height: lines.length * lineBox };
}
