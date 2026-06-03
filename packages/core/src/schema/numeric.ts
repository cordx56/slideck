import { z } from "zod";

// A numeric field that also accepts a "${var}" reference. The string form
// goes unchanged through zod (only checked here to start with "${...}") and
// is resolved later by normalize/variables.resolveNumber, which expands the
// variable, parses the value, and applies range constraints. Any plain
// numeric literal in YAML still parses as a number on the first branch.
//
// Why this matters: ${var} substitution happens in normalize, after zod
// validation. A bare z.number() rejects "${titleSize}" at parse time before
// substitution ever runs, so number-typed fields would refuse references
// even when the variable they point at is itself number-typed.
export const numericSchema = z.union([
  z.number(),
  z.string().refine((s) => /\$\{[^}]+\}/.test(s), {
    message: 'expected a number or a "${var}" reference',
  }),
]);

// Convenience for fields the codebase passes around as number | string.
export type NumericValue = number | string;
