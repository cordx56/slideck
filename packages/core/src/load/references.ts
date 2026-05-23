import { parseDocument, visit, isMap, isSeq, isScalar, type Node } from "yaml";
import type { VFS } from "../vfs";
import { resolvePath, extname } from "../path";

// YAML ファイル内のパス参照 (解決後の絶対パスと元テキスト範囲)。
export interface Reference {
  fromFile: string; // 絶対パス e.g. "/deck.yaml"
  range: [number, number]; // 参照元テキスト内オフセット (lint 用)
  reference: string; // 元の参照文字列
  toPath: string; // 解決後の絶対パス
}

function isYamlPath(path: string): boolean {
  const e = extname(path);
  return e === ".yaml" || e === ".yml";
}

// 1 つの YAML ファイルから path 参照を収集する。
// 対象: bases[].file, extends, fonts.*.path, image.src (group 内含む)。
export function collectFileReferences(fromFile: string, text: string): Reference[] {
  const doc = parseDocument(text);
  const refs: Reference[] = [];

  const push = (node: unknown) => {
    if (!isScalar(node) || typeof node.value !== "string" || !node.range) return;
    const reference = node.value;
    try {
      const toPath = resolvePath(reference, fromFile);
      refs.push({ fromFile, range: [node.range[0], node.range[1]], reference, toPath });
    } catch {
      // ルート脱出など解決不能な参照は無視 (壊れ扱いにはしない)
    }
  };

  push(doc.get("extends", true));

  const bases = doc.get("bases", true);
  if (isSeq(bases)) {
    for (const item of bases.items) {
      if (isMap(item)) push(item.get("file", true));
    }
  }

  const fonts = doc.get("fonts", true);
  if (isMap(fonts)) {
    for (const pair of fonts.items) {
      if (isMap(pair.value)) push((pair.value as { get(k: string, keep: boolean): Node }).get("path", true));
    }
  }

  visit(doc, {
    Map(_key, node) {
      if (node.get("type") === "image") push(node.get("src", true));
    },
  });

  return refs;
}

// プロジェクト全体の壊れた参照を収集する。openFile/openText が与えられた場合、
// そのファイルは保存前のテキストで評価する (エディタの未保存編集を反映)。
export async function collectBrokenReferences(
  vfs: VFS,
  openFile?: string,
  openText?: string,
): Promise<Reference[]> {
  const files = (await vfs.list()).filter((f) => f.kind === "file" && isYamlPath(f.path));
  const refs: Reference[] = [];
  for (const f of files) {
    const text =
      openFile === f.path && openText !== undefined
        ? openText
        : await vfs.readText(f.path);
    refs.push(...collectFileReferences(f.path, text));
  }

  const broken: Reference[] = [];
  for (const r of refs) {
    if (!(await vfs.exists(r.toPath))) broken.push(r);
  }
  return broken;
}
