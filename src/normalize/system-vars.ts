// normalize 時に自動注入するシステム変数。base の layout でもスライドの
// elements でも参照できる。予約名であり schema.vars での再宣言は不可。

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
  slideNumber: number; // 1 始まり
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
