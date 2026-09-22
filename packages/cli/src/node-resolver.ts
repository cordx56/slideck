import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizePath, type AssetResolver } from "@slideck/core";

// AssetResolver that reads the project from disk. Resolves the (root-relative)
// paths the pipeline passes, anchored at the deck directory.
export class NodeAssetResolver implements AssetResolver {
  constructor(private readonly root: string) {}

  private p(path: string): string {
    return resolve(this.root, normalizePath(path).slice(1));
  }

  async readText(path: string): Promise<string> {
    return readFile(this.p(path), "utf8");
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.p(path)));
  }

  async exists(path: string): Promise<boolean> {
    return readFile(this.p(path)).then(
      () => true,
      () => false,
    );
  }
}
