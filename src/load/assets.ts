// アセット解決。プロジェクトルート (deck.yaml のあるディレクトリ) からの
// 相対パスでファイルを読む。実装は fetch 版 / File System Access 版 / ZIP 版。

export interface AssetResolver {
  readText(relativePath: string): Promise<string>;
  readBytes(relativePath: string): Promise<Uint8Array>;
  exists(relativePath: string): Promise<boolean>;
}

// "./a/../b/c" のような相対パスを "b/c" に正規化する。先頭の "./" は除去。
export function normalizePath(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

// あるファイル (dir 部分) を基準に相対パスを解決する。
export function resolveFrom(baseFile: string, relative: string): string {
  const baseDir = baseFile.includes("/")
    ? baseFile.slice(0, baseFile.lastIndexOf("/"))
    : "";
  if (relative.startsWith("/")) return normalizePath(relative);
  return normalizePath(baseDir ? `${baseDir}/${relative}` : relative);
}

// HTTP fetch ベースの resolver。public/examples などの配信パスを root にする。
export class FetchAssetResolver implements AssetResolver {
  // root は末尾スラッシュ付きの URL ベース。
  constructor(private readonly root: string) {}

  private url(relativePath: string): string {
    return this.root + normalizePath(relativePath);
  }

  async readText(relativePath: string): Promise<string> {
    const res = await fetch(this.url(relativePath));
    if (!res.ok) throw new Error(`読み込み失敗: ${relativePath} (${res.status})`);
    return res.text();
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const res = await fetch(this.url(relativePath));
    if (!res.ok) throw new Error(`読み込み失敗: ${relativePath} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const res = await fetch(this.url(relativePath), { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// メモリ上のファイルマップを使う resolver。テストや ZIP 展開後に使う。
export class MemoryAssetResolver implements AssetResolver {
  constructor(private readonly files: Map<string, Uint8Array>) {}

  private get(relativePath: string): Uint8Array {
    const key = normalizePath(relativePath);
    const data = this.files.get(key);
    if (!data) throw new Error(`ファイルがありません: ${key}`);
    return data;
  }

  async readText(relativePath: string): Promise<string> {
    return new TextDecoder().decode(this.get(relativePath));
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    return this.get(relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.files.has(normalizePath(relativePath));
  }
}
