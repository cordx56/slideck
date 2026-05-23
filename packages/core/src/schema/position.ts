import { z } from "zod";

// A length value. Represents % / px / center (left,top only).
// A bare number is interpreted as px.
export type Dimension =
  | { kind: "percent"; value: number }
  | { kind: "px"; value: number }
  | { kind: "center" };

const NUM_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*(%|px)?\s*$/;

// Convert a raw YAML value (string | number) to a Dimension.
// Returns null if it cannot be parsed.
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
          ? `invalid length: ${JSON.stringify(raw)} (e.g. "10%", "20px", 30, "center")`
          : `invalid length: ${JSON.stringify(raw)} (e.g. "10%", "20px", 30)`,
      });
      return z.NEVER;
    }
    return dim;
  });
}

const edgeDim = dimensionSchema(true); // left/top: center allowed
const sizeDim = dimensionSchema(false); // width/height/right/bottom: center not allowed

// position spec. The validity of per-axis combinations is checked in normalize/lower
// (center needs the parent size). Here only each value's format is checked.
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

// Endpoint of a line. Coordinates relative to the parent box.
export const PointSchema = z
  .object({
    x: sizeDim,
    y: sizeDim,
  })
  .strict();

export type Point = z.infer<typeof PointSchema>;
