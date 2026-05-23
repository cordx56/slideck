// Asset resolution. Read files by path relative to the project root (the directory
// containing deck.yaml). Implementations: fetch / File System Access / ZIP.

export interface AssetResolver {
  readText(relativePath: string): Promise<string>;
  readBytes(relativePath: string): Promise<Uint8Array>;
  exists(relativePath: string): Promise<boolean>;
}

// Resolver that supports write-back (local folder / ZIP).
export interface WritableResolver extends AssetResolver {
  writeText(relativePath: string, text: string): Promise<void>;
}

export function isWritable(r: AssetResolver): r is WritableResolver {
  return typeof (r as WritableResolver).writeText === "function";
}

// Normalize a relative path like "./a/../b/c" to "b/c". A leading "./" is stripped.
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

// Resolve a relative path against a file (its dir part) as the base.
export function resolveFrom(baseFile: string, relative: string): string {
  const baseDir = baseFile.includes("/")
    ? baseFile.slice(0, baseFile.lastIndexOf("/"))
    : "";
  if (relative.startsWith("/")) return normalizePath(relative);
  return normalizePath(baseDir ? `${baseDir}/${relative}` : relative);
}

// HTTP fetch based resolver. Uses a serving path such as public/examples as root.
export class FetchAssetResolver implements AssetResolver {
  // root is a URL base with a trailing slash.
  constructor(private readonly root: string) {}

  private url(relativePath: string): string {
    return this.root + normalizePath(relativePath);
  }

  async readText(relativePath: string): Promise<string> {
    const res = await fetch(this.url(relativePath));
    if (!res.ok) throw new Error(`failed to read: ${relativePath} (${res.status})`);
    return res.text();
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const res = await fetch(this.url(relativePath));
    if (!res.ok) throw new Error(`failed to read: ${relativePath} (${res.status})`);
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

// Wrap another resolver and memoize readText/readBytes per path.
// Avoids refetching fonts/images during the editor's live recompile.
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

// Replace the text at given paths with in-memory values and delegate the rest to base.
// Used to reflect the deck.yaml being edited without writing it to disk.
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

// Resolver using an in-memory file map. Used in tests or after ZIP extraction.
export class MemoryAssetResolver implements AssetResolver {
  constructor(private readonly files: Map<string, Uint8Array>) {}

  private get(relativePath: string): Uint8Array {
    const key = normalizePath(relativePath);
    const data = this.files.get(key);
    if (!data) throw new Error(`no such file: ${key}`);
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
