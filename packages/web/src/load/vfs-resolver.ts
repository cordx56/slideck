import type { AssetResolver, VFS } from "@slideck/core";
import { normalize } from "@slideck/core";

// The pipeline passes relative paths ("deck.yaml", "theme.yaml", "img/x.png").
// The VFS uses absolute paths, so normalize them against "/" to bridge.
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
