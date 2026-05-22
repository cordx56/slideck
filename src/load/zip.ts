import JSZip from "jszip";
import { type WritableResolver, normalizePath } from "./assets";

// メモリ上の ZIP を読み書きする resolver。Safari/Firefox 向けフォールバック。
export class ZipAssetResolver implements WritableResolver {
  // rootPrefix は deck.yaml が入るフォルダ ("" か "name/")。
  constructor(
    private readonly zip: JSZip,
    private readonly rootPrefix: string,
  ) {}

  private path(relativePath: string): string {
    return this.rootPrefix + normalizePath(relativePath);
  }

  async readText(relativePath: string): Promise<string> {
    const f = this.zip.file(this.path(relativePath));
    if (!f) throw new Error(`ZIP 内にありません: ${relativePath}`);
    return f.async("string");
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const f = this.zip.file(this.path(relativePath));
    if (!f) throw new Error(`ZIP 内にありません: ${relativePath}`);
    return f.async("uint8array");
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.zip.file(this.path(relativePath)) !== null;
  }

  async writeText(relativePath: string, text: string): Promise<void> {
    this.zip.file(this.path(relativePath), text);
  }

  // 編集後の ZIP を Blob として書き出す (ダウンロード用)。
  toBlob(): Promise<Blob> {
    return this.zip.generateAsync({ type: "blob" });
  }
}

export interface OpenedZip {
  resolver: ZipAssetResolver;
  entry: string;
  name: string;
}

// アップロードされた ZIP を展開し、deck.yaml を含むフォルダを root とする。
export async function openZip(file: File): Promise<OpenedZip> {
  // File を直接渡すと環境によって読めないため、ArrayBuffer を経由する。
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // 最短パスの deck.yaml を探し、その親をプロジェクトルートにする。
  let deckPath: string | undefined;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (path.endsWith("deck.yaml")) {
      if (!deckPath || path.length < deckPath.length) deckPath = path;
    }
  });
  if (!deckPath) throw new Error("ZIP 内に deck.yaml が見つかりません");

  const rootPrefix = deckPath.slice(0, deckPath.length - "deck.yaml".length);
  return {
    resolver: new ZipAssetResolver(zip, rootPrefix),
    entry: "deck.yaml",
    name: file.name,
  };
}
