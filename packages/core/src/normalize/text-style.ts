import type { TextDefaults } from "../ir/hir";
import type { RichStyle } from "../ir/mir";
import { toHex } from "../lib/color";
import type { PipelineError } from "../lib/error";
import { mergeTextDefaults, TEXT_FALLBACK, type ResolvedTextDefaults } from "./defaults";
import type { MergedDefaults } from "./defaults-merge";
import { expandString, resolveNumber, type VarContext } from "./variables";

export function resolveTextDefaults(
  text: TextDefaults,
  vars: VarContext,
  errors: PipelineError[],
): ResolvedTextDefaults {
  const merged = mergeTextDefaults(text);
  // size / lineHeight / letterSpacing may be "${var}" -- expand them now so
  // the rest of normalize sees a plain number. The fallback step in the
  // merge guarantees a non-undefined input, so resolveNumber's ?? branch
  // here only matters if the variable expansion itself failed.
  return {
    family: merged.family,
    // family is the fonts: key (= CSS family) as-is. No key->family translation.
    color: resolveColorLiteral(expandString(merged.color, vars, errors)),
    align: merged.align,
    size:
      resolveNumber(merged.size, vars, errors, {
        field: "defaults.text.size",
        positive: true,
      }) ?? TEXT_FALLBACK.size,
    lineHeight:
      resolveNumber(merged.lineHeight, vars, errors, {
        field: "defaults.text.lineHeight",
        positive: true,
      }) ?? TEXT_FALLBACK.lineHeight,
    letterSpacing:
      resolveNumber(merged.letterSpacing, vars, errors, {
        field: "defaults.text.letterSpacing",
      }) ?? TEXT_FALLBACK.letterSpacing,
  };
}

// Final resolution of color fields: normalize hex, pass others (CSS names etc.) through.
// Palette key resolution is removed. Colors are specified by variable (${...}) or literal string.
// Normalize hex / CSS named colors to canonical "#rrggbb" so renderers
// (especially PDF, which only takes rgb) always get a hex. Unknown strings
// pass through unchanged (the SVG renderer will still try its luck).
export function resolveColorLiteral(value: string): string {
  return toHex(value) ?? value;
}

// Resolve the render style for links and code from defaults.link / defaults.mono.
export function resolveRichStyle(
  defaults: MergedDefaults,
  textDefaults: ResolvedTextDefaults,
  vars: VarContext,
  errors: PipelineError[],
): RichStyle {
  const color = (value: string | undefined, fallback: string) =>
    value ? resolveColorLiteral(expandString(value, vars, errors)) : fallback;
  // Each role family is "" when not explicitly declared. prepare will back-fill
  // any empty role with an auto-detected face (post.isFixedPitch / OS-2 weight /
  // italicAngle); if nothing matches, the role keeps "" and the run renders in
  // the surrounding text font so the measured width matches the render.
  const family = (value: string | undefined): string =>
    value ? expandString(value, vars, errors) : "";
  return {
    linkColor: color(defaults.link.color, textDefaults.color),
    linkUnderline: defaults.link.underline ?? true,
    monoFamily: family(defaults.mono.family),
    monoColor: color(defaults.mono.color, textDefaults.color),
    boldFamily: family(defaults.text.bold),
    italicFamily: family(defaults.text.italic),
    boldItalicFamily: family(defaults.text.boldItalic),
  };
}
