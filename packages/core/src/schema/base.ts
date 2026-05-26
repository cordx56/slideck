import { z } from "zod";
import { ElementSchema } from "./element";
import type { BaseHir } from "../ir/hir";

// Font family names may contain arbitrary Unicode (letters, CJK, punctuation).
// They flow into CSS @font-face / font-family in generated SVG that is later
// injected with {@html}, so reject only control characters and the few that
// could break out of the CSS string / <style> element. The renderer additionally
// escapes these, so this is just an early, clear rejection (defense in depth).
const FamilyName = z
  .string()
  .min(1)
  .refine((s) => !/[\u0000-\u001f<>"&\\]/.test(s), {
    message: 'font family must not contain control characters or any of < > " & \\',
  });

// A font entry is purely a face: a file path + the CSS family name that this
// face registers under. Each face is its own family; roles (bold/italic/mono)
// are assigned in defaults.text / defaults.mono, not via weight/style here.
export const FontDeclSchema = z
  .object({
    path: z.string(),
    family: FamilyName,
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
    // Role slots: the face to use for **bold** / *italic* / both. Reference a
    // fonts: key or a CSS family. Unspecified roles are auto-detected from the
    // loaded fonts (post.isFixedPitch / OS/2 weight / italicAngle).
    bold: FamilyName.optional(),
    italic: FamilyName.optional(),
    boldItalic: FamilyName.optional(),
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
