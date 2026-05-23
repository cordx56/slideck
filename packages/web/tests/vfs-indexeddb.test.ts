import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openVfs } from "../src/vfs";
import type { VFS, VFSEvent } from "../src/vfs";

let vfs: VFS;
let n = 0;

beforeEach(async () => {
  vfs = await openVfs(`test-${n++}-${Date.now()}`);
});

describe("VFS IndexedDB backend", () => {
  it("write, read, and stat", async () => {
    await vfs.writeText("/deck.yaml", "hello");
    expect(await vfs.exists("/deck.yaml")).toBe(true);
    expect(await vfs.readText("/deck.yaml")).toBe("hello");
    const st = await vfs.stat("/deck.yaml");
    expect(st?.kind).toBe("file");
    expect(st?.mimeType).toBe("text/yaml");
  });

  it("auto-creates parent folders", async () => {
    await vfs.writeText("/img/sub/a.txt", "x");
    expect((await vfs.stat("/img"))?.kind).toBe("folder");
    expect((await vfs.stat("/img/sub"))?.kind).toBe("folder");
  });

  it("normalizes paths", async () => {
    await vfs.writeText("/a/../b.txt", "y");
    expect(await vfs.exists("/b.txt")).toBe(true);
  });

  it("delete removes folders recursively", async () => {
    await vfs.writeText("/img/a.png", "a");
    await vfs.writeText("/img/b.png", "b");
    await vfs.delete("/img");
    expect(await vfs.exists("/img")).toBe(false);
    expect(await vfs.exists("/img/a.png")).toBe(false);
    expect(await vfs.exists("/img/b.png")).toBe(false);
  });

  it("move rewrites a folder along with its descendants", async () => {
    await vfs.writeText("/img/a.png", "a");
    await vfs.writeText("/img/sub/c.png", "c");
    await vfs.move("/img", "/assets");
    expect(await vfs.exists("/img/a.png")).toBe(false);
    expect(await vfs.readText("/assets/a.png")).toBe("a");
    expect(await vfs.readText("/assets/sub/c.png")).toBe("c");
  });

  it("rejects a move into its own descendant", async () => {
    await vfs.writeText("/img/a.png", "a");
    await expect(vfs.move("/img", "/img/sub")).rejects.toThrow();
  });

  it("copy duplicates while keeping the source", async () => {
    await vfs.writeText("/a.txt", "1");
    await vfs.copy("/a.txt", "/b.txt");
    expect(await vfs.readText("/a.txt")).toBe("1");
    expect(await vfs.readText("/b.txt")).toBe("1");
  });

  it("meta store get/set", async () => {
    await vfs.setMeta("treeExpanded", ["/img"]);
    expect(await vfs.getMeta<string[]>("treeExpanded")).toEqual(["/img"]);
  });

  it("clear wipes everything", async () => {
    await vfs.writeText("/a.txt", "1");
    await vfs.clear();
    expect(await vfs.list()).toHaveLength(0);
  });

  it("emits events", async () => {
    const events: VFSEvent[] = [];
    vfs.subscribe((e) => events.push(e));
    await vfs.writeText("/a.txt", "1"); // create
    await vfs.writeText("/a.txt", "2"); // update
    await vfs.delete("/a.txt"); // delete
    expect(events.map((e) => e.type)).toEqual(["create", "update", "delete"]);
  });
});
