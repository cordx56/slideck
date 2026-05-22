import { parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { PipelineError, joinPath } from "../lib/error";

export interface ParseOutput<T> {
  value?: T;
  // 検証/構文エラー。空なら value が有効。
  errors: PipelineError[];
  // 位置情報マッピング用に元 Document を保持。
  doc: Document;
}

// YAML テキストをパースし、与えた zod スキーマで検証する。
// YAML 構文エラー・zod エラーともに、可能なら元テキスト上のオフセットを付与する。
export function parseAndValidate<T>(
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  label = "document",
): ParseOutput<T> {
  const doc = parseDocument(text, { keepSourceTokens: true });

  if (doc.errors.length > 0) {
    return {
      doc,
      errors: doc.errors.map(
        (e) =>
          new PipelineError(`YAML 構文エラー (${label}): ${e.message}`, {
            offset: [e.pos[0], e.pos[1]],
          }),
      ),
    };
  }

  const json = doc.toJS({ maxAliasCount: -1 });
  const result = schema.safeParse(json);
  if (result.success) {
    return { doc, value: result.data, errors: [] };
  }

  const errors = result.error.issues.map((iss) => {
    const offset = offsetForPath(doc, iss.path);
    const where = iss.path.length > 0 ? ` at ${joinPath(iss.path)}` : "";
    return new PipelineError(`${label}: ${iss.message}${where}`, {
      path: iss.path,
      offset,
    });
  });
  return { doc, errors };
}

// zod のパスから YAML ノードの range (テキストオフセット) を引く。
export function offsetForPath(
  doc: Document,
  path: (string | number)[],
): [number, number] | undefined {
  // ノードが見つからない場合は親方向にフォールバックする。
  for (let i = path.length; i >= 0; i--) {
    const sub = path.slice(0, i);
    const node = sub.length === 0 ? doc.contents : doc.getIn(sub, true);
    const range = (node as { range?: [number, number, number] } | null)?.range;
    if (range) return [range[0], range[1]];
  }
  return undefined;
}
