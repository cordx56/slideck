import { z } from "zod";
import { PositionSchema, PointSchema, parseDimension } from "./position";
import type { Dimension } from "./position";
import type { HirElement } from "../ir/hir";

const alignSchema = z.enum(["left", "center", "right"]);
const fitSchema = z.enum(["contain", "cover", "fill"]);
const layoutSchema = z.enum(["row", "column"]);
const crossAlignSchema = z.enum(["start", "center", "end", "stretch"]);
const justifySchema = z.enum(["start", "center", "end", "space-between", "space-around"]);

// gap / padding are % or px lengths (center not allowed). A % resolves against
// the slide size by orientation (horizontal->width, vertical->height), so it is
// constant regardless of the group's own (possibly auto) size.
const lengthSchema = z.union([z.string(), z.number()]).transform((raw, ctx): Dimension => {
  const dim = parseDimension(raw, false);
  if (!dim) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `invalid length: ${JSON.stringify(raw)}`,
    });
    return z.NEVER;
  }
  return dim;
});

const baseFields = {
  id: z.string().optional(),
  position: PositionSchema.optional(),
  flex: z.number().optional(),
};

const TextSchema = z
  .object({
    type: z.literal("text"),
    ...baseFields,
    text: z.string(),
    font: z.string().optional(),
    size: z.number().positive().optional(),
    color: z.string().optional(),
    align: alignSchema.optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
  })
  .strict();

const ImageSchema = z
  .object({
    type: z.literal("image"),
    ...baseFields,
    src: z.string(),
    fit: fitSchema.optional(),
  })
  .strict();

const RectSchema = z
  .object({
    type: z.literal("rect"),
    ...baseFields,
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().nonnegative().optional(),
    rx: z.number().nonnegative().optional(),
  })
  .strict();

const LineSchema = z
  .object({
    type: z.literal("line"),
    ...baseFields,
    from: PointSchema,
    to: PointSchema,
    stroke: z.string().optional(),
    strokeWidth: z.number().nonnegative().optional(),
  })
  .strict();

const PathSchema = z
  .object({
    type: z.literal("path"),
    ...baseFields,
    d: z.string(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().nonnegative().optional(),
  })
  .strict();

const GroupSchema = z
  .object({
    type: z.literal("group"),
    ...baseFields,
    layout: layoutSchema.optional(),
    gap: lengthSchema.optional(),
    align: crossAlignSchema.optional(),
    justify: justifySchema.optional(),
    padding: lengthSchema.optional(),
    vars: z.record(z.string(), z.unknown()).optional(),
    children: z.array(z.lazy(() => ElementSchema)),
  })
  .strict();

// Fields shared by ul/ol. Similar to group, but items instead of children.
const listFields = {
  ...baseFields,
  items: z.array(z.lazy(() => ElementSchema)),
  gap: lengthSchema.optional(),
  align: crossAlignSchema.optional(),
  padding: lengthSchema.optional(),
  font: z.string().optional(),
  size: z.number().positive().optional(),
  color: z.string().optional(),
  start: z.number().int().optional(),
};
const UlSchema = z.object({ type: z.literal("ul"), ...listFields }).strict();
const OlSchema = z.object({ type: z.literal("ol"), ...listFields }).strict();

// Infer a missing element `type` from its distinctive fields, to make authoring
// easier (type stays optional but is injected before validation). An explicit
// type always wins. Order matters: each type has a characteristic field.
function inferType(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (o.type !== undefined) return raw;
  const has = (k: string) => o[k] !== undefined;
  let type: string | undefined;
  if (has("text")) type = "text";
  else if (has("src")) type = "image";
  else if (has("d")) type = "path";
  else if (has("from") || has("to")) type = "line";
  else if (has("children")) type = "group";
  else if (has("items")) type = has("start") ? "ol" : "ul";
  else if (has("fill") || has("stroke") || has("strokeWidth") || has("rx")) type = "rect";
  return type === undefined ? raw : { ...o, type };
}

// Recursive element union. lazy because children references ElementSchema.
// Input is raw YAML (to transform into Dimension), so the input type is unknown.
// preprocess injects an inferred `type` when it is omitted.
export const ElementSchema: z.ZodType<HirElement> = z.lazy(() =>
  z.preprocess(
    inferType,
    z.discriminatedUnion("type", [
      TextSchema,
      ImageSchema,
      RectSchema,
      LineSchema,
      PathSchema,
      GroupSchema,
      UlSchema,
      OlSchema,
    ]),
  ),
);
