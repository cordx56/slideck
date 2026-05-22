import type { ThemeHir, VarDecl } from "../ir/hir";
import { PipelineError } from "../lib/error";
import { isHexColor } from "../lib/color";

export interface VarContext {
  // 変数名 -> 解決済み値
  values: Record<string, unknown>;
}

// 変数スコープを解決する: theme.schema.vars の default
//   <- deck-level vars <- slide.vars
// 宣言された変数は型検証し、未宣言の追加変数はそのまま通す。
export function buildVarContext(
  theme: ThemeHir,
  deckVars: Record<string, unknown> | undefined,
  slideVars: Record<string, unknown> | undefined,
  errors: PipelineError[],
): VarContext {
  const decls = theme.schema?.vars ?? {};
  const palette = theme.colors ?? {};
  const values: Record<string, unknown> = {};

  // まず追加 (未宣言) 変数を通す。宣言変数で上書きされる。
  Object.assign(values, deckVars ?? {}, slideVars ?? {});

  for (const [name, decl] of Object.entries(decls)) {
    const provided =
      slideVars?.[name] ?? deckVars?.[name] ?? decl.default ?? undefined;
    if (provided === undefined) {
      if (decl.required) {
        errors.push(new PipelineError(`変数 "${name}" は必須です`));
      }
      continue;
    }
    if (!validateVarType(name, provided, decl, palette, errors)) continue;
    values[name] = provided;
  }

  return { values };
}

function validateVarType(
  name: string,
  value: unknown,
  decl: VarDecl,
  palette: Record<string, string>,
  errors: PipelineError[],
): boolean {
  const fail = (msg: string) => {
    errors.push(new PipelineError(`変数 "${name}": ${msg}`));
    return false;
  };
  switch (decl.type) {
    case "string":
      return typeof value === "string" || fail("string が必要です");
    case "number":
      return typeof value === "number" || fail("number が必要です");
    case "boolean":
      return typeof value === "boolean" || fail("boolean が必要です");
    case "image":
      return typeof value === "string" || fail("画像パス (string) が必要です");
    case "color":
      if (typeof value !== "string") return fail("color (string) が必要です");
      if (isHexColor(value) || value in palette) return true;
      return fail(`未知の色: ${value} (hex か theme.colors のキー)`);
    case "enum":
      if (typeof value !== "string") return fail("enum (string) が必要です");
      if (decl.values?.includes(value)) return true;
      return fail(`許可されない値: ${value} (許可: ${decl.values?.join(", ")})`);
  }
}

const VAR_RE = /\$\{([^}]+)\}/g;
const SINGLE_RE = /^\$\{([^}]+)\}$/;

// 文字列中の ${name} を展開する。文字列全体が単一参照なら値をそのまま
// (文字列化して) 返し、部分参照なら埋め込む。未定義参照はエラー。
export function expandString(
  s: string,
  ctx: VarContext,
  errors: PipelineError[],
): string {
  const single = SINGLE_RE.exec(s);
  if (single) {
    const name = single[1].trim();
    if (!(name in ctx.values)) {
      errors.push(new PipelineError(`未定義の変数参照: \${${name}}`));
      return s;
    }
    return stringify(ctx.values[name]);
  }
  return s.replace(VAR_RE, (_m, raw: string) => {
    const name = raw.trim();
    if (!(name in ctx.values)) {
      errors.push(new PipelineError(`未定義の変数参照: \${${name}}`));
      return "";
    }
    return stringify(ctx.values[name]);
  });
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}
