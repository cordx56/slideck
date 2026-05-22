import { z } from "zod";
import { ElementSchema } from "./element";
import type { DeckHir } from "../ir/hir";

const SlideSchema = z
  .object({
    id: z.string(),
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
  .strict();
