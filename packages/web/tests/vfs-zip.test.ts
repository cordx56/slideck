import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { readZip, writeZip } from "../src/vfs/zip";
import { openVfs } from "../src/vfs";

describe("vfs/zip helpers", () => {
  it("writeZip -> readZip ラウンドトリップ", async () => {
    const blob = writeZip([
      { path: "deck.yaml", data: new TextEncoder().encode("hello") },
      { path: "img/a.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const entries = await readZip(blob);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.data]));
    expect(new TextDecoder().decode(byPath["deck.yaml"])).toBe("hello");
    expect(Array.from(byPath["img/a.png"])).toEqual([1, 2, 3]);
  });
});

describe("VFS importZip / exportZip", () => {
  it("import 後にファイルが展開され、export でラウンドトリップする", async () => {
    const vfs = await openVfs(`zip-${Date.now()}`);
    const blob = writeZip([
      { path: "deck.yaml", data: new TextEncoder().encode("bases: []\nslides: []") },
      { path: "fonts/x.ttf", data: new Uint8Array([0, 1, 2, 3]) },
    ]);
    await vfs.importZip(blob);
    expect(await vfs.readText("/deck.yaml")).toContain("bases");
    expect(Array.from(await vfs.readBytes("/fonts/x.ttf"))).toEqual([0, 1, 2, 3]);

    const out = await vfs.exportZip();
    const entries = await readZip(out);
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["deck.yaml", "fonts/x.ttf"]);
  });
});
