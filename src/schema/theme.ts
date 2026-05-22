import { z } from "zod";
import { ElementSchema } from "./element";
import type { ThemeHir } from "../ir/hir";

const FontDeclSchema = z
  .object({
    path: z.string(),
    family: z.string(),
    weight: z.number().optional(),
    style: z.enum(["normal", "italic"]).optional(),
  })
  .strict();

const VarDeclSchema = z
  .object({
    type: z.enum(["string", "number", "boolean", "color", "image", "enum"]),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    values: z.array(z.string()).optional(),
  })
  .strict();

const TextDefaultsSchema = z
  .object({
    family: z.string().optional(),
    size: z.number().positive().optional(),
    color: z.string().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
  })
  .strict();

export const ThemeSchema: z.ZodType<ThemeHir, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string(),
    extends: z.string().optional(),
    fonts: z.record(FontDeclSchema).optional(),
    colors: z.record(z.string()).optional(),
    slide: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
    background: z.string().optional(),
    defaults: z.object({ text: TextDefaultsSchema.optional() }).strict().optional(),
    schema: z
      .object({ vars: z.record(VarDeclSchema).optional() })
      .strict()
      .optional(),
    layout: z.array(ElementSchema).optional(),
  })
  .strict();
