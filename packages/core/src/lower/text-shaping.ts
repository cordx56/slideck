import type { Align } from "../ir/hir";
import { type FontMetrics, isCJK } from "./metrics";

export interface ShapedLine {
  text: string;
  x: number; // ボックス左端からの x オフセット (align 適用後)
  baseline: number; // ボックス上端からのベースライン y
  width: number;
}

export interface ShapedText {
  lines: ShapedLine[];
  width: number; // 最大行幅
  height: number; // 総高さ
}

type TokenKind = "word" | "space" | "cjk";
interface Token {
  text: string;
  kind: TokenKind;
}

// 1段落をトークン列に分解する。
// 英数字の連続は word (スペース境界で改行)、CJK は1文字ごと (どこでも改行可)、
// 連続する空白は1つの space トークンにまとめる。
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

// 段落を maxWidth に収まる視覚行へ greedy に分割する。
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
  const tokenW = (t: Token) =>
    metrics.measure(t.text, font, size) + letterSpacing * [...t.text].length;

  for (const t of tokens) {
    const w = tokenW(t);
    if (line !== "" && lineW + w > limit && t.kind !== "space") {
      lines.push(line.replace(/\s+$/, ""));
      line = "";
      lineW = 0;
    }
    if (line === "" && t.kind === "space") continue; // 行頭スペースは捨てる
    line += t.text;
    lineW += w;
  }
  lines.push(line.replace(/\s+$/, ""));
  return lines;
}

// テキストを行単位にシェイプする。SVG/PDF で共有される唯一の折り返し処理。
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
      metrics.measure(lineText, font, size) +
      letterSpacing * Math.max(0, [...lineText].length - 1);
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
