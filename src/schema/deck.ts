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
    // id は任意。省略時は normalize がインデックス由来の id を割り当てる。
    id: z.string().optional(),
    // use は単一/配列の両方を受ける (normalize で配列化)。
    use: z.union([z.string(), z.array(z.string())]).optional(),
    vars: z.record(z.unknown()).optional(),
    background: z.string().optional(),
    elements: z.array(ElementSchema).optional(),
  })
  .strict();

export const DeckSchema: z.ZodType<DeckHir, z.ZodTypeDef, unknown> = z
  .object({
    // base 定義。always:true は全スライドに自動適用、それ以外は use: で選択。
    bases: z.array(BaseRefSchema).min(1, "bases は1つ以上必要です"),
    vars: z.record(z.unknown()).optional(),
    slides: z.array(SlideSchema).min(1, "slides は1つ以上必要です"),
  })
  .strict()
  .superRefine((deck, ctx) => {
    // base id の重複を検出。
    const baseIds = new Set<string>();
    deck.bases.forEach((b, i) => {
      if (baseIds.has(b.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `base id "${b.id}" が重複しています`,
          path: ["bases", i, "id"],
        });
      } else {
        baseIds.add(b.id);
      }
    });

    // 明示された slide id の重複を検出 (任意なので未指定は対象外)。
    const slideIds = new Set<string>();
    deck.slides.forEach((slide, i) => {
      if (slide.id === undefined) return;
      if (slideIds.has(slide.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `スライド id "${slide.id}" が重複しています`,
          path: ["slides", i, "id"],
        });
      } else {
        slideIds.add(slide.id);
      }
    });

    // use: が存在しない base id を参照していないか検証。
    const useRefs = (u: string | string[] | undefined): string[] =>
      u === undefined ? [] : Array.isArray(u) ? u : [u];
    deck.slides.forEach((slide, i) => {
      useRefs(slide.use).forEach((id, j) => {
        if (!baseIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `スライドが未知の base "${id}" を use しています`,
            path: ["slides", i, "use", ...(Array.isArray(slide.use) ? [j] : [])],
          });
        }
      });
    });
  });
