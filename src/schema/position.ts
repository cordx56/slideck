import { z } from "zod";

// 長さの値。% / px / center(left,topのみ) を表す。
// 数値のみの指定は px として解釈する。
export type Dimension =
  | { kind: "percent"; value: number }
  | { kind: "px"; value: number }
  | { kind: "center" };

const NUM_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*(%|px)?\s*$/;

// 生の YAML 値 (string | number) を Dimension に変換する。
// 解析できない場合は null。
export function parseDimension(raw: unknown, allowCenter: boolean): Dimension | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return { kind: "px", value: raw };
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "center") {
    return allowCenter ? { kind: "center" } : null;
  }
  const m = NUM_UNIT_RE.exec(trimmed);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2];
  if (unit === "%") return { kind: "percent", value };
  return { kind: "px", value };
}

function dimensionSchema(allowCenter: boolean) {
  return z.union([z.string(), z.number()]).transform((raw, ctx): Dimension => {
    const dim = parseDimension(raw, allowCenter);
    if (!dim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: allowCenter
          ? `不正な長さ指定: ${JSON.stringify(raw)} (例: "10%", "20px", 30, "center")`
          : `不正な長さ指定: ${JSON.stringify(raw)} (例: "10%", "20px", 30)`,
      });
      return z.NEVER;
    }
    return dim;
  });
}

const edgeDim = dimensionSchema(true); // left/top: center 許可
const sizeDim = dimensionSchema(false); // width/height/right/bottom: center 不可

// position 指定。各軸の組み合わせ妥当性は normalize/lower で検証する
// (center は親サイズが必要なため)。ここでは個々の値の形式のみ検証。
export const PositionSchema = z
  .object({
    left: edgeDim.optional(),
    top: edgeDim.optional(),
    right: sizeDim.optional(),
    bottom: sizeDim.optional(),
    width: sizeDim.optional(),
    height: sizeDim.optional(),
  })
  .strict();

export type Position = z.infer<typeof PositionSchema>;

// line の端点。親ボックスに対する相対座標。
export const PointSchema = z
  .object({
    x: sizeDim,
    y: sizeDim,
  })
  .strict();

export type Point = z.infer<typeof PointSchema>;
