import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { buildTree, flattenVisible } from "../src/app/editor/tree";
import { uniqueName, detectConflicts } from "../src/app/editor/file-ops";
import { openVfs } from "../src/vfs";
import type { FileEntry } from "../src/vfs";

const f = (path: string, kind: "file" | "folder"): FileEntry => ({
  path,
  kind,
  modifiedAt: 0,
});

describe("buildTree", () => {
  const files = [
    f("/img", "folder"),
    f("/img/b.png", "file"),
    f("/img/a.png", "file"),
    f("/deck.yaml", "file"),
    f("/.hidden", "file"),
  ];

  it("ネストし、フォルダ先 -> ファイルで自然順ソートする", () => {
    const tree = buildTree(files, false);
    expect(tree.map((n) => n.name)).toEqual(["img", "deck.yaml"]); // folder first
    const img = tree[0];
    expect(img.children.map((n) => n.name)).toEqual(["a.png", "b.png"]); // natural
  });

  it("隠しファイルは showHidden=false で除外", () => {
    expect(buildTree(files, false).some((n) => n.name === ".hidden")).toBe(false);
    expect(buildTree(files, true).some((n) => n.name === ".hidden")).toBe(true);
  });

  it("欠落した祖先フォルダも合成する", () => {
    const tree = buildTree([f("/a/b/c.txt", "file")], false);
    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c.txt");
  });
});

describe("flattenVisible", () => {
  it("展開フォルダの子だけを表示順に並べる", () => {
    const tree = buildTree(
      [f("/img", "folder"), f("/img/a.png", "file"), f("/deck.yaml", "file")],
      false,
    );
    expect(flattenVisible(tree, new Set()).map((n) => n.name)).toEqual([
      "img",
      "deck.yaml",
    ]);
    expect(flattenVisible(tree, new Set(["/img"])).map((n) => n.name)).toEqual([
      "img",
      "a.png",
      "deck.yaml",
    ]);
  });
});

describe("file-ops", () => {
  it("uniqueName は衝突を避ける", async () => {
    const vfs = await openVfs(`tree-${Date.now()}`);
    await vfs.writeText("/img/a.png", "x");
    expect(await uniqueName(vfs, "/img", "a.png")).toBe("a copy.png");
    await vfs.writeText("/img/a copy.png", "x");
    expect(await uniqueName(vfs, "/img", "a.png")).toBe("a copy 2.png");
    expect(await uniqueName(vfs, "/img", "new.png")).toBe("new.png");
  });

  it("detectConflicts は既存パスを返す", async () => {
    const vfs = await openVfs(`tree2-${Date.now()}`);
    await vfs.writeText("/img/a.png", "x");
    expect(await detectConflicts(vfs, "/img", ["a.png", "b.png"])).toEqual(["a.png"]);
  });
});
