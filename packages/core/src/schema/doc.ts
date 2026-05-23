// Generate schema documentation (field types + named-alias expansions) from the
// zod schemas, so editor tooltips follow the schema instead of hand-written
// strings. Walks the zod 4 internal def (s._zod.def).
import { PositionSchema, PointSchema } from "./position";
import { ElementSchema } from "./element";
import { DeckSchema, BaseRefSchema, SlideSchema } from "./deck";
import { BaseSchema, FontDeclSchema, VarDeclSchema } from "./base";

interface Def {
  type: string;
  innerType?: Schema;
  element?: Schema;
  options?: Schema[];
  shape?: Record<string, Schema>;
  keyType?: Schema;
  valueType?: Schema;
  values?: unknown[];
  entries?: Record<string, unknown>;
  in?: Schema;
  getter?: () => Schema;
}
interface Schema {
  _zod: { def: Def };
}

const def = (s: Schema): Def => s._zod.def;
const as = (s: unknown): Schema => s as Schema;

// Schemas rendered by name (not inlined) wherever they appear.
const REGISTRY = new Map<Schema, string>([
  [as(PositionSchema), "Position"],
  [as(PointSchema), "Point"],
  [as(ElementSchema), "Element"],
  [as(BaseRefSchema), "BaseRef"],
  [as(SlideSchema), "Slide"],
  [as(FontDeclSchema), "FontDecl"],
  [as(VarDeclSchema), "VarDecl"],
]);

// Strip optional/default wrappers; report whether the field is optional.
function unwrap(s: Schema): { schema: Schema; optional: boolean } {
  let cur = s;
  let optional = false;
  while (def(cur).type === "optional" || def(cur).type === "default") {
    optional = true;
    cur = def(cur).innerType!;
  }
  return { schema: cur, optional };
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

// Concise type string. Registered schemas render as their alias name.
function printType(s: Schema): string {
  const { schema } = unwrap(s);
  const named = REGISTRY.get(schema);
  if (named) return named;
  const d = def(schema);
  switch (d.type) {
    case "lazy": {
      const inner = d.getter!();
      return REGISTRY.get(inner) ?? printType(inner);
    }
    case "array":
      return `${printType(d.element!)}[]`;
    case "union":
      return uniq(d.options!.map(printType)).join(" | ");
    case "pipe":
      return printType(d.in!); // transform: describe the input the user writes
    case "record":
      return `Record<${printType(d.keyType!)}, ${printType(d.valueType!)}>`;
    case "literal":
      return d
        .values!.map((v) => (typeof v === "string" ? `'${v}'` : JSON.stringify(v)))
        .join(" | ");
    case "enum":
      return Object.keys(d.entries!)
        .map((v) => `'${v}'`)
        .join(" | ");
    case "object":
      // Inline objects show field names only (kept short); named ones use REGISTRY.
      return `{ ${Object.entries(def(schema).shape!)
        .map(([n, fs]) => n + (unwrap(fs).optional ? "?" : ""))
        .join(", ")} }`;
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "unknown":
    case "any":
      return "value";
    default:
      return d.type;
  }
}

// Full "{ field?: Type; ... }" expansion of an object schema.
function expandObject(s: Schema): string {
  return `{ ${Object.entries(def(s).shape!)
    .map(([n, fs]) => {
      const { schema, optional } = unwrap(fs);
      return `${n}${optional ? "?" : ""}: ${printType(schema)}`;
    })
    .join("; ")} }`;
}

const COMMON = new Set(["type", "id", "position", "flex"]);

// Multi-line expansion of the Element union: one line per variant.
function expandElement(): string {
  const union = def(def(as(ElementSchema)).getter!());
  const lines = union.options!.map((v) => {
    const shape = def(v).shape!;
    const tag = String((def(shape.type).values ?? [""])[0]);
    const fields = Object.entries(shape)
      .filter(([n]) => !COMMON.has(n))
      .map(([n, fs]) => n + (unwrap(fs).optional ? "?" : ""));
    return `  ${tag.padEnd(6)} { ${fields.join(", ")} }`;
  });
  return ["by 'type':", ...lines, "  common: id?, position?: Position, flex?"].join("\n");
}

export interface SchemaDocs {
  fields: Record<string, string>; // field name -> type string (merged across objects)
  aliases: Record<string, string>; // alias name -> expansion
}

function build(): SchemaDocs {
  const aliasObjects: [string, Schema][] = [
    ["Position", as(PositionSchema)],
    ["Point", as(PointSchema)],
    ["BaseRef", as(BaseRefSchema)],
    ["Slide", as(SlideSchema)],
    ["FontDecl", as(FontDeclSchema)],
    ["VarDecl", as(VarDeclSchema)],
  ];
  const aliases: Record<string, string> = { Element: expandElement() };
  for (const [name, s] of aliasObjects) aliases[name] = expandObject(s);

  // Flat field -> type, merged across the commonly edited objects.
  const elementVariants = def(def(as(ElementSchema)).getter!()).options!;
  const objects: Schema[] = [
    as(DeckSchema),
    as(SlideSchema),
    as(BaseRefSchema),
    as(BaseSchema),
    as(FontDeclSchema),
    as(VarDeclSchema),
    as(PositionSchema),
    as(PointSchema),
    ...elementVariants,
  ];
  const sets: Record<string, Set<string>> = {};
  for (const obj of objects) {
    for (const [name, fs] of Object.entries(def(obj).shape ?? {})) {
      (sets[name] ??= new Set()).add(printType(unwrap(fs).schema));
    }
  }
  const fields: Record<string, string> = {};
  for (const [name, set] of Object.entries(sets)) fields[name] = [...set].join(" | ");

  return { fields, aliases };
}

// Generated once at load. If introspection ever fails, fall back to empty docs
// so the editor still works (tooltips simply do not show).
export const schemaDocs: SchemaDocs = (() => {
  try {
    return build();
  } catch {
    return { fields: {}, aliases: {} };
  }
})();
