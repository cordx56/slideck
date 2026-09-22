import { normalizePath } from "../path";

// Asset resolution. Read files by absolute, root-relative VFS path.

export interface AssetResolver {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

// Resolver that supports write-back (local folder / ZIP).
export interface WritableResolver extends AssetResolver {
  writeText(path: string, text: string): Promise<void>;
}

export function isWritable(r: AssetResolver): r is WritableResolver {
  return typeof (r as WritableResolver).writeText === "function";
}

// HTTP fetch based resolver. Uses a serving path such as public/examples as root.
export class FetchAssetResolver implements AssetResolver {
  // root is a URL base with a trailing slash.
  constructor(private readonly root: string) {}

  private url(path: string): string {
    return this.root + normalizePath(path).slice(1);
  }

  async readText(path: string): Promise<string> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`failed to read: ${path} (${res.status})`);
    return res.text();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`failed to read: ${path} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    try {
      const res = await fetch(this.url(path), { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// Wrap another resolver and memoize readText/readBytes per path.
// Avoids refetching fonts/images during the editor's live recompile.
export class CachingResolver implements AssetResolver {
  private textCache = new Map<string, Promise<string>>();
  private bytesCache = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly base: AssetResolver) {}

  readText(path: string): Promise<string> {
    const key = normalizePath(path);
    let p = this.textCache.get(key);
    if (!p) {
      p = this.base.readText(key);
      this.textCache.set(key, p);
    }
    return p;
  }

  readBytes(path: string): Promise<Uint8Array> {
    const key = normalizePath(path);
    let p = this.bytesCache.get(key);
    if (!p) {
      p = this.base.readBytes(key);
      this.bytesCache.set(key, p);
    }
    return p;
  }

  exists(path: string): Promise<boolean> {
    return this.base.exists(normalizePath(path));
  }

  invalidate(path?: string): void {
    if (path === undefined) {
      this.textCache.clear();
      this.bytesCache.clear();
      return;
    }
    const key = normalizePath(path);
    this.textCache.delete(key);
    this.bytesCache.delete(key);
  }
}

// Replace the text at given paths with in-memory values and delegate the rest to base.
// Used to reflect the deck.yaml being edited without writing it to disk.
export class OverrideResolver implements AssetResolver {
  constructor(
    private readonly base: AssetResolver,
    private readonly overrides: Map<string, string>,
  ) {}

  async readText(path: string): Promise<string> {
    const key = normalizePath(path);
    const override = this.overrides.get(key);
    if (override !== undefined) return override;
    return this.base.readText(key);
  }

  readBytes(path: string): Promise<Uint8Array> {
    return this.base.readBytes(normalizePath(path));
  }

  exists(path: string): Promise<boolean> {
    const key = normalizePath(path);
    if (this.overrides.has(key)) return Promise.resolve(true);
    return this.base.exists(key);
  }
}

// Resolver using an in-memory file map. Used in tests or after ZIP extraction.
export class MemoryAssetResolver implements AssetResolver {
  constructor(private readonly files: Map<string, Uint8Array>) {}

  private get(path: string): Uint8Array {
    const key = normalizePath(path);
    const data = this.files.get(key);
    if (!data) throw new Error(`no such file: ${key}`);
    return data;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(this.get(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.get(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizePath(path));
  }
}
