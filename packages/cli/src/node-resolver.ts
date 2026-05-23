import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetResolver } from "@slideck/core";

// AssetResolver that reads the project from disk. Resolves the (root-relative)
// paths the pipeline passes, anchored at the deck directory.
export class NodeAssetResolver implements AssetResolver {
  constructor(private readonly root: string) {}

  private p(rel: string): string {
    return resolve(this.root, rel.replace(/^\/+/, ""));
  }

  async readText(rel: string): Promise<string> {
    return readFile(this.p(rel), "utf8");
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.p(rel)));
  }

  async exists(rel: string): Promise<boolean> {
    return readFile(this.p(rel)).then(
      () => true,
      () => false,
    );
  }
}
