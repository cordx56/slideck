import { z } from "zod";
import { ElementSchema } from "./element";
import type { BaseHir } from "../ir/hir";

const FontDeclSchema = z
  .object({
    path: z.string(),
    family: z.string(),
    weight: z.number().optional(),
    style: z.enum(["normal", "italic"]).optional(),
    // Font index used for a .ttc (TrueType Collection) (default 0).
    index: z.number().int().nonnegative().optional(),
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

const LinkDefaultsSchema = z
  .object({ color: z.string().optional(), underline: z.boolean().optional() })
  .strict();

const MonoDefaultsSchema = z
  .object({ family: z.string().optional(), color: z.string().optional() })
  .strict();

// Schema for the base file body (old theme.yaml structure). id is on the deck.bases side.
export const BaseSchema: z.ZodType<BaseHir, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string().optional(),
    extends: z.string().optional(),
    fonts: z.record(FontDeclSchema).optional(),
    colors: z.record(z.string()).optional(),
    slide: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
    background: z.string().optional(),
    defaults: z
      .object({
        text: TextDefaultsSchema.optional(),
        link: LinkDefaultsSchema.optional(),
        mono: MonoDefaultsSchema.optional(),
      })
      .strict()
      .optional(),
    schema: z
      .object({ vars: z.record(VarDeclSchema).optional() })
      .strict()
      .optional(),
    layout: z.array(ElementSchema).optional(),
  })
  .strict();
