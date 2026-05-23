import type { AssetResolver, VFS } from "@slider/core";
import { normalize } from "@slider/core";

// パイプラインは相対パス ("deck.yaml", "theme.yaml", "img/x.png") を渡す。
// VFS は絶対パスなので "/" 起点に正規化して橋渡しする。
export class VfsResolver implements AssetResolver {
  constructor(private readonly vfs: VFS) {}

  private abs(rel: string): string {
    return normalize(rel.startsWith("/") ? rel : "/" + rel);
  }

  readText(rel: string): Promise<string> {
    return this.vfs.readText(this.abs(rel));
  }

  readBytes(rel: string): Promise<Uint8Array> {
    return this.vfs.readBytes(this.abs(rel));
  }

  exists(rel: string): Promise<boolean> {
    return this.vfs.exists(this.abs(rel));
  }
}
