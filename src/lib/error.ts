// パイプライン全体で使う構造化エラー。YAML 上の位置情報を保持し、
// エディタのリンター表示や CLI 風出力に使う。

export interface SourcePos {
  // YAML ドキュメント上の論理パス (例: ["slides", 0, "vars", "title"])
  path?: (string | number)[];
  // テキストオフセット [from, to]
  offset?: [number, number];
}

export class PipelineError extends Error {
  readonly pos?: SourcePos;

  constructor(message: string, pos?: SourcePos) {
    super(message);
    this.name = "PipelineError";
    this.pos = pos;
  }
}

export function joinPath(path: (string | number)[]): string {
  return path
    .map((p) => (typeof p === "number" ? `[${p}]` : p))
    .join(".")
    .replace(/\.\[/g, "[");
}
