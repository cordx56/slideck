// アセット解決。プロジェクトルート (deck.yaml のあるディレクトリ) からの
// 相対パスでファイルを読む。実装は fetch 版 / File System Access 版 / ZIP 版。

export interface AssetResolver {
  readText(relativePath: string): Promise<string>;
  readBytes(relativePath: string): Promise<Uint8Array>;
  exists(relativePath: string): Promise<boolean>;
}

// 書き戻しに対応する resolver (ローカルフォルダ / ZIP)。
export interface WritableResolver extends AssetResolver {
  writeText(relativePath: string, text: string): Promise<void>;
}

export function isWritable(r: AssetResolver): r is WritableResolver {
  return typeof (r as WritableResolver).writeText === "function";
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

// 別 resolver をラップし、readText/readBytes をパス単位でメモ化する。
// エディタのライブ再コンパイルでフォント/画像の再取得を避ける。
export class CachingResolver implements AssetResolver {
  private textCache = new Map<string, Promise<string>>();
  private bytesCache = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly base: AssetResolver) {}

  readText(relativePath: string): Promise<string> {
    const key = normalizePath(relativePath);
    let p = this.textCache.get(key);
    if (!p) {
      p = this.base.readText(relativePath);
      this.textCache.set(key, p);
    }
    return p;
  }

  readBytes(relativePath: string): Promise<Uint8Array> {
    const key = normalizePath(relativePath);
    let p = this.bytesCache.get(key);
    if (!p) {
      p = this.base.readBytes(relativePath);
      this.bytesCache.set(key, p);
    }
    return p;
  }

  exists(relativePath: string): Promise<boolean> {
    return this.base.exists(relativePath);
  }

  invalidate(relativePath?: string): void {
    if (relativePath === undefined) {
      this.textCache.clear();
      this.bytesCache.clear();
      return;
    }
    const key = normalizePath(relativePath);
    this.textCache.delete(key);
    this.bytesCache.delete(key);
  }
}

// 指定パスのテキストをメモリ上の値で差し替え、他は base に委譲する。
// エディタが編集中の deck.yaml をディスクに書かずに反映するために使う。
export class OverrideResolver implements AssetResolver {
  constructor(
    private readonly base: AssetResolver,
    private readonly overrides: Map<string, string>,
  ) {}

  async readText(relativePath: string): Promise<string> {
    const key = normalizePath(relativePath);
    const override = this.overrides.get(key);
    if (override !== undefined) return override;
    return this.base.readText(relativePath);
  }

  readBytes(relativePath: string): Promise<Uint8Array> {
    return this.base.readBytes(relativePath);
  }

  exists(relativePath: string): Promise<boolean> {
    if (this.overrides.has(normalizePath(relativePath))) return Promise.resolve(true);
    return this.base.exists(relativePath);
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
