import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

// localStorage シム (Node 環境用)。projects.ts は呼び出し時に参照する。
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

import {
  listProjects,
  projectExists,
  registerProject,
  unregisterProject,
  dbNameFor,
  getLastProject,
  setLastProject,
} from "../src/app/projects";
import { openVfs } from "../src/vfs";

describe("project registry", () => {
  it("register / exists / list", () => {
    expect(projectExists("a")).toBe(false);
    registerProject("a");
    registerProject("b");
    registerProject("a"); // 重複は no-op
    expect(projectExists("a")).toBe(true);
    expect(listProjects().map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  it("unregister removes and clears last", () => {
    registerProject("a");
    setLastProject("a");
    unregisterProject("a");
    expect(projectExists("a")).toBe(false);
    expect(getLastProject()).toBeNull();
  });

  it("dbNameFor は名前ごとに異なる", () => {
    expect(dbNameFor("a")).not.toBe(dbNameFor("b"));
  });
});

describe("プロジェクトごとの VFS 分離", () => {
  it("別名 DB の内容は混ざらない", async () => {
    const a = await openVfs(dbNameFor("proj-a"));
    const b = await openVfs(dbNameFor("proj-b"));
    await a.writeText("/deck.yaml", "A");
    await b.writeText("/deck.yaml", "B");
    expect(await a.readText("/deck.yaml")).toBe("A");
    expect(await b.readText("/deck.yaml")).toBe("B");
    expect(await b.exists("/only-a.txt")).toBe(false);
  });
});
