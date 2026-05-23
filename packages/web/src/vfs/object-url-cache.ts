// Cache of path -> Object URL. Invalidated and revoked on VFS events.
export class ObjectURLCache {
  private cache = new Map<string, string>();

  constructor(private readonly read: (path: string) => Promise<Blob>) {}

  async get(path: string): Promise<string> {
    const hit = this.cache.get(path);
    if (hit) return hit;
    const blob = await this.read(path);
    const url = URL.createObjectURL(blob);
    this.cache.set(path, url);
    return url;
  }

  // When path is omitted, revoke all URLs (e.g. on app teardown).
  invalidate(path?: string): void {
    if (path === undefined) {
      for (const url of this.cache.values()) URL.revokeObjectURL(url);
      this.cache.clear();
      return;
    }
    const url = this.cache.get(path);
    if (url) {
      URL.revokeObjectURL(url);
      this.cache.delete(path);
    }
  }
}
