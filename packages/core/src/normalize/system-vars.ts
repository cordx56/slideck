// System variables auto-injected during normalize. Referable both in a base layout
// and in slide elements. They are reserved names and cannot be redeclared in schema.vars.

export const SYSTEM_VAR_NAMES = [
  "slideNumber",
  "slideCount",
  "slideId",
  "baseIds",
] as const;

export function isReservedVar(name: string): boolean {
  return (SYSTEM_VAR_NAMES as readonly string[]).includes(name);
}

export interface SystemVarInput {
  slideId: string;
  slideNumber: number; // 1-based
  slideCount: number;
  baseIds: string[];
}

export function buildSystemVars(input: SystemVarInput): Record<string, unknown> {
  return {
    slideNumber: input.slideNumber,
    slideCount: input.slideCount,
    slideId: input.slideId,
    baseIds: input.baseIds,
  };
}
