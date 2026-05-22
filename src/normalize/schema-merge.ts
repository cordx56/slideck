import type { VarDecl } from "../ir/hir";
import { PipelineError } from "../lib/error";
import type { AppliedBase } from "./bases";

// 適用される全 base の schema.vars を union マージする。
// - 型一致: OK / 型不一致: エラー / required は OR / default は後勝ち
export function mergeSchemas(
  applied: AppliedBase[],
  errors: PipelineError[],
): Record<string, VarDecl> {
  const merged: Record<string, VarDecl> = {};
  const owner: Record<string, string> = {}; // 変数名 -> 最初の宣言元 base id

  for (const { id, base } of applied) {
    const vars = base.schema?.vars ?? {};
    for (const [name, decl] of Object.entries(vars)) {
      const existing = merged[name];
      if (!existing) {
        merged[name] = { ...decl };
        owner[name] = id;
        continue;
      }
      if (existing.type !== decl.type) {
        errors.push(
          new PipelineError(
            `変数 "${name}" の型が base 間で競合: "${owner[name]}" は ${existing.type}, "${id}" は ${decl.type}`,
          ),
        );
        continue; // 既存の宣言を保持
      }
      merged[name] = {
        type: existing.type,
        required: existing.required || decl.required,
        default: decl.default !== undefined ? decl.default : existing.default,
        values: decl.values ?? existing.values,
      };
    }
  }
  return merged;
}
