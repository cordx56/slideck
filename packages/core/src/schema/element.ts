import { z } from "zod";
import { PositionSchema, PointSchema, parseDimension } from "./position";
import type { Dimension } from "./position";
import type { HirElement } from "../ir/hir";

const alignSchema = z.enum(["left", "center", "right"]);
const fitSchema = z.enum(["contain", "cover", "fill"]);
const layoutSchema = z.enum(["row", "column"]);
const crossAlignSchema = z.enum(["start", "center", "end", "stretch"]);
const justifySchema = z.enum(["start", "center", "end", "space-between", "space-around"]);

// gap / padding are % or px lengths (center not allowed).
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
    vars: z.record(z.unknown()).optional(),
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

// Recursive element union. lazy because children references ElementSchema.
// Input is raw YAML (to transform into Dimension), so the input type is unknown.
export const ElementSchema: z.ZodType<HirElement, z.ZodTypeDef, unknown> = z.lazy(() =>
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
);
