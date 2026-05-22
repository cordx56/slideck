import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { collectFileReferences, collectBrokenReferences } from "../src/load/references";
import { openVfs } from "../src/vfs";

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

describe("collectFileReferences", () => {
  it("deck.yaml の bases[].file と image.src を解決する", () => {
    const refs = collectFileReferences("/deck.yaml", deck);
    const toPaths = refs.map((r) => r.toPath).sort();
    expect(toPaths).toEqual(["/img/cover.png", "/theme.yaml"]);
    for (const r of refs) expect(r.range[1]).toBeGreaterThan(r.range[0]);
  });

  it("base ファイルの extends / fonts.path / 絶対 image.src", () => {
    const refs = collectFileReferences("/theme.yaml", theme);
    const toPaths = refs.map((r) => r.toPath).sort();
    expect(toPaths).toEqual(["/base.yaml", "/fonts/x.ttf", "/img/logo.png"]);
  });
});

describe("collectBrokenReferences", () => {
  it("存在しない参照先を壊れた参照として返す", async () => {
    const vfs = await openVfs(`ref-${Date.now()}`);
    await vfs.writeText("/deck.yaml", deck);
    await vfs.writeText("/theme.yaml", theme.replace("extends: ./base.yaml\n", ""));
    // img/cover.png, fonts/x.ttf, img/logo.png は未作成 -> 壊れ
    const broken = await collectBrokenReferences(vfs);
    const paths = broken.map((b) => b.toPath).sort();
    expect(paths).toEqual(["/fonts/x.ttf", "/img/cover.png", "/img/logo.png"]);

    // 参照先を用意すると壊れが減る
    await vfs.writeText("/img/cover.png", "x");
    const broken2 = await collectBrokenReferences(vfs);
    expect(broken2.map((b) => b.toPath)).not.toContain("/img/cover.png");
  });

  it("未保存テキストを優先評価する", async () => {
    const vfs = await openVfs(`ref2-${Date.now()}`);
    await vfs.writeText("/deck.yaml", `bases: []\nslides: []`);
    // 保存版には参照なし。編集中テキストに壊れ参照を入れる。
    const edited = `bases: [{ id: b, file: ./missing.yaml }]\nslides: []`;
    const broken = await collectBrokenReferences(vfs, "/deck.yaml", edited);
    expect(broken.map((b) => b.toPath)).toContain("/missing.yaml");
  });
});
