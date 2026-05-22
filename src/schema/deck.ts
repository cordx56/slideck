import { z } from "zod";
import { ElementSchema } from "./element";
import type { DeckHir } from "../ir/hir";

const SlideSchema = z
  .object({
    // id は任意。省略時は normalize がインデックス由来の id を割り当てる。
    id: z.string().optional(),
    use: z.string().optional(),
    vars: z.record(z.unknown()).optional(),
    background: z.string().optional(),
    elements: z.array(ElementSchema).optional(),
  })
  .strict();

export const DeckSchema: z.ZodType<DeckHir, z.ZodTypeDef, unknown> = z
  .object({
    // theme/themes/overlays はファイルパス参照 (loader が解決)。
    theme: z.string().optional(),
    themes: z.array(z.string()).optional(),
    overlays: z.array(z.string()).optional(),
    vars: z.record(z.unknown()).optional(),
    slides: z.array(SlideSchema).min(1, "slides は1つ以上必要です"),
  })
  .strict()
  // 明示された id の重複を検出する (任意なので未指定は対象外)。
  .superRefine((deck, ctx) => {
    const seen = new Set<string>();
    deck.slides.forEach((slide, i) => {
      if (slide.id === undefined) return;
      if (seen.has(slide.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `スライド id "${slide.id}" が重複しています`,
          path: ["slides", i, "id"],
        });
      } else {
        seen.add(slide.id);
      }
    });
  });
