import { z } from "zod";
import { PositionSchema, PointSchema, parseDimension } from "./position";
import type { Dimension } from "./position";
import type { HirElement } from "../ir/hir";

const alignSchema = z.enum(["left", "center", "right"]);
const fitSchema = z.enum(["contain", "cover", "fill"]);
const layoutSchema = z.enum(["row", "column"]);
const crossAlignSchema = z.enum(["start", "center", "end", "stretch"]);
const justifySchema = z.enum([
  "start",
  "center",
  "end",
  "space-between",
  "space-around",
]);

// gap / padding は % または px の長さ (center 不可)。
const lengthSchema = z.union([z.string(), z.number()]).transform(
  (raw, ctx): Dimension => {
    const dim = parseDimension(raw, false);
    if (!dim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `不正な長さ指定: ${JSON.stringify(raw)}`,
      });
      return z.NEVER;
    }
    return dim;
  },
);

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

// ul/ol 共通フィールド。group に近いが children ではなく items。
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

const MathSchema = z
  .object({
    type: z.literal("math"),
    ...baseFields,
    tex: z.string(),
    size: z.number().positive().optional(),
    color: z.string().optional(),
    display: z.boolean().optional(),
  })
  .strict();

// 再帰的な要素 union。children が ElementSchema を参照するため lazy。
// 入力は生の YAML (Dimension へ transform するため) なので input 型は unknown。
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
    MathSchema,
  ]),
);
