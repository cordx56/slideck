// フォント計測の抽象。SVG と PDF で同じシェイピング結果を得るため、
// lower は具体的なフォントバックエンドに依存せずこの interface を使う。
// Phase 1 は近似メトリクス、Phase 2 で実フォント (fontkit) 版に差し替え可能。

export interface FontMetrics {
  // text を font/size で描画したときの advance 幅 (px)。
  measure(text: string, font: string, size: number): number;
  // ベースラインがテキスト行ボックス上端から下がる比率 (size 倍で px)。
  ascentRatio(font: string): number;
}

function isCJK(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x30ff) || // 句読点・ひらがな・カタカナ
    (code >= 0x3400 && code <= 0x9fff) || // CJK 統合漢字 (拡張A含む)
    (code >= 0xf900 && code <= 0xfaff) || // 互換漢字
    (code >= 0xff00 && code <= 0xffef) // 全角英数・記号
  );
}

// フォントファイルを使わない近似メトリクス。全角=1em、ASCII は文字種別の
// 概算幅。実フォントが無い環境 (テスト/初期プレビュー) で wrapping を成立させる。
export class ApproximateMetrics implements FontMetrics {
  measure(text: string, _font: string, size: number): number {
    let w = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      w += charWidthRatio(ch, code) * size;
    }
    return w;
  }

  ascentRatio(): number {
    return 0.8;
  }
}

function charWidthRatio(ch: string, code: number): number {
  if (isCJK(code)) return 1.0;
  if (ch === " ") return 0.28;
  if (ch === "\t") return 1.0;
  if (/[iIl.,:;'!|]/.test(ch)) return 0.28;
  if (/[mwMW]/.test(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.65;
  if (/[0-9]/.test(ch)) return 0.55;
  return 0.5;
}

export { isCJK };
