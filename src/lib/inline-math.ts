// テキスト中のインライン数式 ($...$) を扱う。
// 変数展開は ${...} なので $x$ とは衝突しない。

export interface MathSegment {
  math: boolean;
  value: string; // text 部はそのまま、math 部は中身の TeX
}

const INLINE_RE = /\$([^$]+)\$/g;

export function hasInlineMath(text: string): boolean {
  return /\$[^$]+\$/.test(text);
}

// テキストを text / math セグメントに分割する。
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

// $ 区切りを外した素のテキスト (PDF フォールバック・高さ計算用)。
export function stripInlineMath(text: string): string {
  return parseInlineMath(text)
    .map((s) => s.value)
    .join("");
}
