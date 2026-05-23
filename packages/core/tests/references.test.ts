import { describe, it, expect } from "vitest";
import { collectFileReferences, collectBrokenReferences } from "../src/load/references";
import type { VFS, FileEntry } from "../src/vfs";

const deck = `bases:
  - { id: base, always: true, file: ./theme.yaml }
slides:
  - id: s
    elements:
      - { type: image, src: ./img/cover.png }
`;

const theme = `extends: ./base.yaml
fonts:
  body: { path: ./fonts/x.ttf, family: Body }
layout:
  - { type: image, src: /img/logo.png }
`;

// Minimal VFS mock holding only text files (core tests do not depend on impl).
function mockVfs(files: Record<string, string>): VFS {
  const enc = new TextEncoder();
  const has = (p: string) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    async list() {
      return Object.keys(files).map(
        (path): FileEntry => ({ path, kind: "file", modifiedAt: 0 }),
      );
    },
    async exists(p) {
      return has(p);
    },
    async readText(p) {
      return files[p];
    },
    async readBytes(p) {
      return enc.encode(files[p]);
    },
    // Unused methods are dummies.
    stat: async () => null,
    readBlob: async () => new Blob(),
    getObjectURL: async () => "",
    writeBlob: async () => {},
    writeText: async (p, t) => {
      files[p] = t;
    },
    createFolder: async () => {},
    move: async () => {},
    copy: async () => {},
    delete: async () => {},
    importZip: async () => {},
    exportZip: async () => new Blob(),
    clear: async () => {},
    getMeta: async () => undefined,
    setMeta: async () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}

describe("collectFileReferences", () => {
  it("resolves bases[].file and image.src in deck.yaml", () => {
    const refs = collectFileReferences("/deck.yaml", deck);
    const toPaths = refs.map((r) => r.toPath).sort();
    expect(toPaths).toEqual(["/img/cover.png", "/theme.yaml"]);
    for (const r of refs) expect(r.range[1]).toBeGreaterThan(r.range[0]);
  });

  it("base file extends / fonts.path / absolute image.src", () => {
    const refs = collectFileReferences("/theme.yaml", theme);
    const toPaths = refs.map((r) => r.toPath).sort();
    expect(toPaths).toEqual(["/base.yaml", "/fonts/x.ttf", "/img/logo.png"]);
  });
});

describe("collectBrokenReferences", () => {
  it("returns nonexistent targets as broken references", async () => {
    const vfs = mockVfs({
      "/deck.yaml": deck,
      "/theme.yaml": theme.replace("extends: ./base.yaml\n", ""),
    });
    const broken = await collectBrokenReferences(vfs);
    expect(broken.map((b) => b.toPath).sort()).toEqual([
      "/fonts/x.ttf",
      "/img/cover.png",
      "/img/logo.png",
    ]);

    await vfs.writeText("/img/cover.png", "x");
    const broken2 = await collectBrokenReferences(vfs);
    expect(broken2.map((b) => b.toPath)).not.toContain("/img/cover.png");
  });

  it("prefers unsaved text when evaluating", async () => {
    const vfs = mockVfs({ "/deck.yaml": `bases: []\nslides: []` });
    const edited = `bases: [{ id: b, file: ./missing.yaml }]\nslides: []`;
    const broken = await collectBrokenReferences(vfs, "/deck.yaml", edited);
    expect(broken.map((b) => b.toPath)).toContain("/missing.yaml");
  });
});
