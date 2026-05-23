// deck.yaml の AST (yaml Document) を直接編集することで、コメントや
// フォーマットを保ったまま in-place 更新する。インスペクタ書き戻しの基盤。
import { parseDocument, isSeq, YAMLSeq, type Document } from "yaml";

export type Path = (string | number)[];

export interface ElementRef {
  index: number;
  path: Path; // doc 上のパス
  type: string;
  summary: string;
}

export function parseDeck(text: string): Document {
  return parseDocument(text);
}

export function serialize(doc: Document): string {
  return doc.toString();
}

// 指定スライドの elements を AST から列挙する (ソース要素のみ)。
export function listSlideElements(doc: Document, slideIndex: number): ElementRef[] {
  const node = doc.getIn(["slides", slideIndex, "elements"], true);
  if (!isSeq(node)) return [];
  return node.items.map((_item, i) => {
    const path: Path = ["slides", slideIndex, "elements", i];
    const type = String(doc.getIn([...path, "type"]) ?? "?");
    return { index: i, path, type, summary: summarize(doc, path, type) };
  });
}

function summarize(doc: Document, path: Path, type: string): string {
  if (type === "text") return String(doc.getIn([...path, "text"]) ?? "");
  if (type === "image") return String(doc.getIn([...path, "src"]) ?? "");
  if (type === "group") {
    const layout = doc.getIn([...path, "layout"]);
    return layout ? `layout: ${layout}` : "group";
  }
  return "";
}

// フィールド (ネスト可、例 ["position","left"]) を取得して文字列化する。
export function getField(doc: Document, elPath: Path, field: Path): string {
  const v = doc.getIn([...elPath, ...field]);
  return v === undefined || v === null ? "" : String(v);
}

// フィールドを設定する。空文字は削除を意味する。
// value は number/boolean に見えるものは適切な型に変換する。
export function setField(
  doc: Document,
  elPath: Path,
  field: Path,
  raw: string,
): void {
  const full = [...elPath, ...field];
  if (raw === "") {
    doc.deleteIn(full);
    return;
  }
  doc.setIn(full, coerce(raw));
}

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return raw;
}

const TEMPLATES: Record<string, () => Record<string, unknown>> = {
  text: () => ({
    type: "text",
    position: { left: "10%", top: "10%", width: "80%" },
    text: "新規テキスト",
  }),
  image: () => ({
    type: "image",
    position: { left: "10%", top: "10%", width: "30%" },
    src: "./img/cover.png",
  }),
  rect: () => ({
    type: "rect",
    position: { left: "10%", top: "10%", width: "30%", height: "20%" },
    fill: "accent",
    rx: 12,
  }),
  group: () => ({
    type: "group",
    position: { left: "10%", top: "10%", width: "80%", height: "40%" },
    layout: "column",
    gap: "3%",
    children: [],
  }),
};

// 指定スライドの elements 末尾に要素テンプレートを追加し、index を返す。
export function addElement(
  doc: Document,
  slideIndex: number,
  type: string,
): number {
  const elsPath: Path = ["slides", slideIndex, "elements"];
  const existing = doc.getIn(elsPath, true);
  const seq: YAMLSeq = isSeq(existing) ? existing : new YAMLSeq();
  if (!isSeq(existing)) doc.setIn(elsPath, seq);
  const make = TEMPLATES[type] ?? TEMPLATES.text;
  // 平の JS オブジェクトは Node に変換しないと getIn できないため createNode する。
  seq.add(doc.createNode(make()));
  return seq.items.length - 1;
}

export function removeElement(doc: Document, elPath: Path): void {
  doc.deleteIn(elPath);
}
