import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

// localStorage shim (for Node). projects.ts references it at call time.
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
    registerProject("a"); // duplicate is a no-op
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

  it("dbNameFor differs per name", () => {
    expect(dbNameFor("a")).not.toBe(dbNameFor("b"));
  });
});

describe("per-project VFS isolation", () => {
  it("contents of differently named DBs do not mix", async () => {
    const a = await openVfs(dbNameFor("proj-a"));
    const b = await openVfs(dbNameFor("proj-b"));
    await a.writeText("/deck.yaml", "A");
    await b.writeText("/deck.yaml", "B");
    expect(await a.readText("/deck.yaml")).toBe("A");
    expect(await b.readText("/deck.yaml")).toBe("B");
    expect(await b.exists("/only-a.txt")).toBe(false);
  });
});
