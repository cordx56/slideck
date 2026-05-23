// Structured error used throughout the pipeline. Holds position info in the YAML,
// for the editor's linter display and CLI-style output.

export interface SourcePos {
  // logical path in the YAML document (e.g. ["slides", 0, "vars", "title"])
  path?: (string | number)[];
  // text offset [from, to]
  offset?: [number, number];
}

export class PipelineError extends Error {
  readonly pos?: SourcePos;

  constructor(message: string, pos?: SourcePos) {
    super(message);
    this.name = "PipelineError";
    this.pos = pos;
  }
}

export function joinPath(path: (string | number)[]): string {
  return path
    .map((p) => (typeof p === "number" ? `[${p}]` : p))
    .join(".")
    .replace(/\.\[/g, "[");
}
