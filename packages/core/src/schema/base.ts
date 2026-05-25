import { z } from "zod";
import { ElementSchema } from "./element";
import type { BaseHir } from "../ir/hir";

// Conservative allowlist for font family names. These flow into CSS @font-face /
// font-family in generated SVG, so disallow characters that could break out of
// the CSS string or <style> element (the SVG is later injected with {@html}).
const FamilyName = z
  .string()
  .regex(/^[\p{L}\p{N} ._-]+$/u, "font family may contain only letters, digits, spaces, . _ -");

export const FontDeclSchema = z
  .object({
    path: z.string(),
    family: FamilyName,
    weight: z.number().optional(),
    style: z.enum(["normal", "italic"]).optional(),
    // Font index used for a .ttc (TrueType Collection) (default 0).
    index: z.number().int().nonnegative().optional(),
  })
  .strict();

export const VarDeclSchema = z
  .object({
    type: z.enum(["string", "number", "boolean", "color", "image", "enum"]),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    values: z.array(z.string()).optional(),
  })
  .strict();

const TextDefaultsSchema = z
  .object({
    family: FamilyName.optional(),
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
  .object({ family: FamilyName.optional(), color: z.string().optional() })
  .strict();

// Schema for the base file body (old theme.yaml structure). id is on the deck.bases side.
export const BaseSchema: z.ZodType<BaseHir> = z
  .object({
    name: z.string().optional(),
    extends: z.string().optional(),
    fonts: z.record(z.string(), FontDeclSchema).optional(),
    colors: z.record(z.string(), z.string()).optional(),
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
      .object({ vars: z.record(z.string(), VarDeclSchema).optional() })
      .strict()
      .optional(),
    layout: z.array(ElementSchema).optional(),
  })
  .strict();
