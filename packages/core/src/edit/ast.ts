// Edit the deck.yaml AST (yaml Document) directly to update in place while
// preserving comments and formatting. The basis for inspector write-back.
import { parseDocument, isSeq, YAMLSeq, type Document } from "yaml";

export type Path = (string | number)[];

export interface ElementRef {
  index: number;
  path: Path; // path in the doc
  type: string;
  summary: string;
}

export function parseDeck(text: string): Document {
  return parseDocument(text);
}

export function serialize(doc: Document): string {
  return doc.toString();
}

// Enumerate the given slide's elements from the AST (source elements only).
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

// Get a field (nestable, e.g. ["position","left"]) and stringify it.
export function getField(doc: Document, elPath: Path, field: Path): string {
  const v = doc.getIn([...elPath, ...field]);
  return v === undefined || v === null ? "" : String(v);
}

// Set a field. An empty string means delete.
// Values that look like a number/boolean are converted to the appropriate type.
export function setField(doc: Document, elPath: Path, field: Path, raw: string): void {
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
    text: "New text",
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

// Append an element template to the end of the given slide's elements and return the index.
export function addElement(doc: Document, slideIndex: number, type: string): number {
  const elsPath: Path = ["slides", slideIndex, "elements"];
  const existing = doc.getIn(elsPath, true);
  const seq: YAMLSeq = isSeq(existing) ? existing : new YAMLSeq();
  if (!isSeq(existing)) doc.setIn(elsPath, seq);
  const make = TEMPLATES[type] ?? TEMPLATES.text;
  // A plain JS object must be converted to a Node for getIn, so createNode it.
  seq.add(doc.createNode(make()));
  return seq.items.length - 1;
}

export function removeElement(doc: Document, elPath: Path): void {
  doc.deleteIn(elPath);
}
