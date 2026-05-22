import type { VarDecl } from "../ir/hir";
import { PipelineError } from "../lib/error";
import { isHexColor } from "../lib/color";
import { isReservedVar } from "./system-vars";

export interface VarContext {
  // 変数名 -> 解決済み値
  values: Record<string, unknown>;
}

// 変数スコープを解決する。優先度 (低->高):
//   システム変数 < schema default < deck.vars < slide.vars
// マージ済み schema (全 base 合成済み) で型検証する。未宣言の追加変数は通す。
export function buildVarContext(
  mergedVars: Record<string, VarDecl>,
  systemVars: Record<string, unknown>,
  deckVars: Record<string, unknown> | undefined,
  slideVars: Record<string, unknown> | undefined,
  palette: Record<string, string>,
  errors: PipelineError[],
): VarContext {
  const values: Record<string, unknown> = {};

  // システム変数を土台に置く (最低優先度)。
  Object.assign(values, systemVars);

  // 宣言された default を載せる。
  for (const [name, decl] of Object.entries(mergedVars)) {
    if (isReservedVar(name)) {
      errors.push(
        new PipelineError(`"${name}" はシステム変数のため schema.vars で宣言できません`),
      );
      continue;
    }
    if (decl.default !== undefined) values[name] = decl.default;
  }

  // ユーザ変数 (未宣言含む) を載せる。slide が deck を上書き。
  Object.assign(values, deckVars ?? {});
  for (const name of Object.keys(slideVars ?? {})) {
    if (isReservedVar(name)) {
      errors.push(
        new PipelineError(`システム変数 "${name}" を slide.vars で上書きしています`),
      );
    }
  }
  Object.assign(values, slideVars ?? {});

  // 宣言変数の required / 型を検証する。
  for (const [name, decl] of Object.entries(mergedVars)) {
    if (isReservedVar(name)) continue;
    const value = values[name];
    if (value === undefined) {
      if (decl.required) errors.push(new PipelineError(`変数 "${name}" は必須です`));
      continue;
    }
    validateVarType(name, value, decl, palette, errors);
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
