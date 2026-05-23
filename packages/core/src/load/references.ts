import { parseDocument, visit, isMap, isSeq, isScalar, type Node } from "yaml";
import type { VFS } from "../vfs";
import { resolvePath, extname } from "../path";

// Path reference inside a YAML file (resolved absolute path and source text range).
export interface Reference {
  fromFile: string; // absolute path e.g. "/deck.yaml"
  range: [number, number]; // offset within the source text (for lint)
  reference: string; // original reference string
  toPath: string; // resolved absolute path
}

function isYamlPath(path: string): boolean {
  const e = extname(path);
  return e === ".yaml" || e === ".yml";
}

// Collect path references from a single YAML file.
// Targets: bases[].file, extends, fonts.*.path, image.src (including inside group).
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
      // Ignore unresolvable references such as escaping root (not treated as broken)
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
      if (isMap(pair.value))
        push((pair.value as { get(k: string, keep: boolean): Node }).get("path", true));
    }
  }

  visit(doc, {
    Map(_key, node) {
      if (node.get("type") === "image") push(node.get("src", true));
    },
  });

  return refs;
}

// Collect broken references across the whole project. If openFile/openText are given,
// that file is evaluated against its pre-save text (reflects unsaved editor edits).
export async function collectBrokenReferences(
  vfs: VFS,
  openFile?: string,
  openText?: string,
): Promise<Reference[]> {
  const files = (await vfs.list()).filter((f) => f.kind === "file" && isYamlPath(f.path));
  const refs: Reference[] = [];
  for (const f of files) {
    let text: string;
    if (openFile === f.path && openText !== undefined) {
      text = openText;
    } else {
      // The file may vanish between list() and readText() (e.g. a concurrent
      // rename/delete). Skip it rather than throwing.
      try {
        text = await vfs.readText(f.path);
      } catch {
        continue;
      }
    }
    refs.push(...collectFileReferences(f.path, text));
  }

  const broken: Reference[] = [];
  for (const r of refs) {
    if (!(await vfs.exists(r.toPath))) broken.push(r);
  }
  return broken;
}
