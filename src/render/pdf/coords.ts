// 座標系変換。LIR は左上原点・Y下向き、PDF は左下原点・Y上向き。

// 上端 y (LIR) を持つ高さ h の矩形 -> PDF の下端 y。
export function rectY(yTop: number, h: number, pageHeight: number): number {
  return pageHeight - yTop - h;
}

// LIR の y (上から) を PDF の y (下から) に反転。
// テキストはベースライン基準なのでこの変換のみで合う。
export function flipY(y: number, pageHeight: number): number {
  return pageHeight - y;
}
