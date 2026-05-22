import { describe, it, expect } from "vitest";
import {
  parseDeck,
  serialize,
  listSlideElements,
  getField,
  setField,
  addElement,
  removeElement,
} from "../src/edit/ast";

const deck = `# プロジェクト deck
theme: ./theme.yaml
slides:
  - id: intro
    elements:
      - type: text # タイトル
        text: こんにちは
        size: 40
`;

describe("AST 編集 (インスペクタ書き戻し)", () => {
  it("フィールド更新がコメントと書式を保持する", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "72");
    const out = serialize(doc);
    expect(out).toContain("# プロジェクト deck");
    expect(out).toContain("# タイトル");
    expect(out).toContain("size: 72");
    expect(out).not.toContain("size: 40");
  });

  it("数値・真偽値は適切な型に変換される", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "50");
    // JSON 化して number であることを確認
    const v = doc.getIn(["slides", 0, "elements", 0, "size"]);
    expect(v).toBe(50);
    expect(typeof v).toBe("number");
  });

  it("空文字はフィールド削除", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "");
    expect(doc.getIn(["slides", 0, "elements", 0, "size"])).toBeUndefined();
  });

  it("ネストした position フィールドを設定する", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["position", "left"], "10%");
    expect(getField(doc, ["slides", 0, "elements", 0], ["position", "left"])).toBe(
      "10%",
    );
  });

  it("要素を追加・列挙・削除できる", () => {
    const doc = parseDeck(deck);
    const idx = addElement(doc, 0, "rect");
    expect(idx).toBe(1);
    let els = listSlideElements(doc, 0);
    expect(els).toHaveLength(2);
    expect(els[1].type).toBe("rect");

    removeElement(doc, ["slides", 0, "elements", 1]);
    els = listSlideElements(doc, 0);
    expect(els).toHaveLength(1);
  });

  it("elements が無いスライドにも追加できる", () => {
    const doc = parseDeck(`theme: ./t.yaml\nslides:\n  - id: blank\n`);
    addElement(doc, 0, "text");
    expect(listSlideElements(doc, 0)).toHaveLength(1);
  });
});
