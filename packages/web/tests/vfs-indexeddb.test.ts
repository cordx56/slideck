import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openVfs } from "../src/vfs";
import type { VFS, VFSEvent } from "../src/vfs";

let vfs: VFS;
let n = 0;

beforeEach(async () => {
  vfs = await openVfs(`test-${n++}-${Date.now()}`);
});

describe("VFS IndexedDB バックエンド", () => {
  it("書き込み・読み出し・stat", async () => {
    await vfs.writeText("/deck.yaml", "hello");
    expect(await vfs.exists("/deck.yaml")).toBe(true);
    expect(await vfs.readText("/deck.yaml")).toBe("hello");
    const st = await vfs.stat("/deck.yaml");
    expect(st?.kind).toBe("file");
    expect(st?.mimeType).toBe("text/yaml");
  });

  it("親フォルダを自動生成する", async () => {
    await vfs.writeText("/img/sub/a.txt", "x");
    expect((await vfs.stat("/img"))?.kind).toBe("folder");
    expect((await vfs.stat("/img/sub"))?.kind).toBe("folder");
  });

  it("パスは正規化される", async () => {
    await vfs.writeText("/a/../b.txt", "y");
    expect(await vfs.exists("/b.txt")).toBe(true);
  });

  it("delete はフォルダを再帰削除する", async () => {
    await vfs.writeText("/img/a.png", "a");
    await vfs.writeText("/img/b.png", "b");
    await vfs.delete("/img");
    expect(await vfs.exists("/img")).toBe(false);
    expect(await vfs.exists("/img/a.png")).toBe(false);
    expect(await vfs.exists("/img/b.png")).toBe(false);
  });

  it("move はフォルダごと子孫を書き換える", async () => {
    await vfs.writeText("/img/a.png", "a");
    await vfs.writeText("/img/sub/c.png", "c");
    await vfs.move("/img", "/assets");
    expect(await vfs.exists("/img/a.png")).toBe(false);
    expect(await vfs.readText("/assets/a.png")).toBe("a");
    expect(await vfs.readText("/assets/sub/c.png")).toBe("c");
  });

  it("自身の子孫への move は拒否", async () => {
    await vfs.writeText("/img/a.png", "a");
    await expect(vfs.move("/img", "/img/sub")).rejects.toThrow();
  });

  it("copy は元を残して複製する", async () => {
    await vfs.writeText("/a.txt", "1");
    await vfs.copy("/a.txt", "/b.txt");
    expect(await vfs.readText("/a.txt")).toBe("1");
    expect(await vfs.readText("/b.txt")).toBe("1");
  });

  it("meta store の get/set", async () => {
    await vfs.setMeta("treeExpanded", ["/img"]);
    expect(await vfs.getMeta<string[]>("treeExpanded")).toEqual(["/img"]);
  });

  it("clear で全消去", async () => {
    await vfs.writeText("/a.txt", "1");
    await vfs.clear();
    expect(await vfs.list()).toHaveLength(0);
  });

  it("イベントを発火する", async () => {
    const events: VFSEvent[] = [];
    vfs.subscribe((e) => events.push(e));
    await vfs.writeText("/a.txt", "1"); // create
    await vfs.writeText("/a.txt", "2"); // update
    await vfs.delete("/a.txt"); // delete
    expect(events.map((e) => e.type)).toEqual(["create", "update", "delete"]);
  });
});
