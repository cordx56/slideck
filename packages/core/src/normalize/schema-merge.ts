import type { VarDecl } from "../ir/hir";
import { PipelineError } from "../lib/error";
import type { AppliedBase } from "./bases";

// Union-merge the schema.vars of all applied bases.
// - same type: OK / type mismatch: error / required is OR / default is last wins
export function mergeSchemas(
  applied: AppliedBase[],
  errors: PipelineError[],
): Record<string, VarDecl> {
  const merged: Record<string, VarDecl> = {};
  const owner: Record<string, string> = {}; // variable name -> base id that first declared it

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
            `type of variable "${name}" conflicts between bases: "${owner[name]}" is ${existing.type}, "${id}" is ${decl.type}`,
          ),
        );
        continue; // keep the existing declaration
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
