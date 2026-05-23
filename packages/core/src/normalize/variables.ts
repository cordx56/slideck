import type { VarDecl } from "../ir/hir";
import { PipelineError } from "../lib/error";
import { isHexColor } from "../lib/color";
import { isReservedVar } from "./system-vars";

export interface VarContext {
  // variable name -> resolved value
  values: Record<string, unknown>;
}

// Resolve the variable scope. Priority (low->high):
//   system vars < base colors < schema default < deck.vars < slide.vars
// base colors are also injected as variables (referable via ${bg} etc.).
// Type-check against the merged schema (composed from all bases). Extra undeclared vars pass.
export function buildVarContext(
  mergedVars: Record<string, VarDecl>,
  systemVars: Record<string, unknown>,
  colors: Record<string, string>,
  deckVars: Record<string, unknown> | undefined,
  slideVars: Record<string, unknown> | undefined,
  errors: PipelineError[],
): VarContext {
  const values: Record<string, unknown> = {};

  // Lay system vars as the base (lowest priority).
  Object.assign(values, systemVars);
  // Inject base colors as variables (overridable).
  Object.assign(values, colors);

  // Apply declared defaults.
  for (const [name, decl] of Object.entries(mergedVars)) {
    if (isReservedVar(name)) {
      errors.push(
        new PipelineError(`"${name}" is a system variable and cannot be declared in schema.vars`),
      );
      continue;
    }
    if (decl.default !== undefined) values[name] = decl.default;
  }

  // Apply user variables (including undeclared). slide overrides deck.
  Object.assign(values, deckVars ?? {});
  for (const name of Object.keys(slideVars ?? {})) {
    if (isReservedVar(name)) {
      errors.push(
        new PipelineError(`overriding system variable "${name}" in slide.vars`),
      );
    }
  }
  Object.assign(values, slideVars ?? {});

  // Validate required / type of declared variables.
  for (const [name, decl] of Object.entries(mergedVars)) {
    if (isReservedVar(name)) continue;
    const value = values[name];
    if (value === undefined) {
      if (decl.required) errors.push(new PipelineError(`variable "${name}" is required`));
      continue;
    }
    validateVarType(name, value, decl, errors);
  }

  return { values };
}

function validateVarType(
  name: string,
  value: unknown,
  decl: VarDecl,
  errors: PipelineError[],
): boolean {
  const fail = (msg: string) => {
    errors.push(new PipelineError(`variable "${name}": ${msg}`));
    return false;
  };
  switch (decl.type) {
    case "string":
      return typeof value === "string" || fail("string required");
    case "number":
      return typeof value === "number" || fail("number required");
    case "boolean":
      return typeof value === "boolean" || fail("boolean required");
    case "image":
      return typeof value === "string" || fail("image path (string) required");
    case "color":
      if (typeof value !== "string") return fail("color (string) required");
      if (isHexColor(value)) return true;
      return fail(`unknown color: ${value} (hex string required)`);
    case "enum":
      if (typeof value !== "string") return fail("enum (string) required");
      if (decl.values?.includes(value)) return true;
      return fail(`disallowed value: ${value} (allowed: ${decl.values?.join(", ")})`);
  }
}

const VAR_RE = /\$\{([^}]+)\}/g;
const SINGLE_RE = /^\$\{([^}]+)\}$/;

// Expand ${name} in a string. If the whole string is a single reference, return the
// value as is (stringified); if a partial reference, embed it. Undefined refs are errors.
export function expandString(
  s: string,
  ctx: VarContext,
  errors: PipelineError[],
): string {
  const single = SINGLE_RE.exec(s);
  if (single) {
    const name = single[1].trim();
    if (!(name in ctx.values)) {
      errors.push(new PipelineError(`undefined variable reference: \${${name}}`));
      return s;
    }
    return stringify(ctx.values[name]);
  }
  return s.replace(VAR_RE, (_m, raw: string) => {
    const name = raw.trim();
    if (!(name in ctx.values)) {
      errors.push(new PipelineError(`undefined variable reference: \${${name}}`));
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
