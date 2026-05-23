import { z } from "zod";
import { ElementSchema } from "./element";
import type { DeckHir } from "../ir/hir";

const BaseRefSchema = z
  .object({
    id: z.string(),
    always: z.boolean().optional(),
    file: z.string(),
  })
  .strict();

const SlideSchema = z
  .object({
    // id is optional. When omitted, normalize assigns an index-derived id.
    id: z.string().optional(),
    // use accepts either a single value or an array (normalize wraps it in an array).
    use: z.union([z.string(), z.array(z.string())]).optional(),
    vars: z.record(z.unknown()).optional(),
    background: z.string().optional(),
    elements: z.array(ElementSchema).optional(),
  })
  .strict();

export const DeckSchema: z.ZodType<DeckHir, z.ZodTypeDef, unknown> = z
  .object({
    // base definitions. always:true auto-applies to all slides; others are selected via use:.
    bases: z.array(BaseRefSchema).min(1, "at least one base is required"),
    vars: z.record(z.unknown()).optional(),
    slides: z.array(SlideSchema).min(1, "at least one slide is required"),
  })
  .strict()
  .superRefine((deck, ctx) => {
    // Detect duplicate base ids.
    const baseIds = new Set<string>();
    deck.bases.forEach((b, i) => {
      if (baseIds.has(b.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate base id "${b.id}"`,
          path: ["bases", i, "id"],
        });
      } else {
        baseIds.add(b.id);
      }
    });

    // Detect duplicate explicit slide ids (optional, so unspecified ones are excluded).
    const slideIds = new Set<string>();
    deck.slides.forEach((slide, i) => {
      if (slide.id === undefined) return;
      if (slideIds.has(slide.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate slide id "${slide.id}"`,
          path: ["slides", i, "id"],
        });
      } else {
        slideIds.add(slide.id);
      }
    });

    // Verify that use: does not reference a nonexistent base id.
    const useRefs = (u: string | string[] | undefined): string[] =>
      u === undefined ? [] : Array.isArray(u) ? u : [u];
    deck.slides.forEach((slide, i) => {
      useRefs(slide.use).forEach((id, j) => {
        if (!baseIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `slide uses unknown base "${id}"`,
            path: ["slides", i, "use", ...(Array.isArray(slide.use) ? [j] : [])],
          });
        }
      });
    });
  });
