import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { openZip } from "../src/load/zip";
import { compileDeck, recompileDeck, renderSlideSvg } from "../src/pipeline";
import { OverrideResolver } from "../src/load/assets";
import type { MirText } from "../src/ir";

const theme = `
name: standard
slide: { width: 200, height: 100 }
defaults: { text: { size: 12 } }
schema: { vars: { title: { type: string, required: true } } }
layout:
  - { type: text, text: "\${title}" }
`;
const deck = `theme: ./theme.yaml\nslides: [{ id: s, vars: { title: "ジップ" } }]`;

async function makeZipFile(prefix: string): Promise<File> {
  const zip = new JSZip();
  zip.file(`${prefix}deck.yaml`, deck);
  zip.file(`${prefix}theme.yaml`, theme);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([bytes as BlobPart], "proj.zip", { type: "application/zip" });
}

describe("openZip", () => {
  it("ルート直下の deck.yaml を読みレンダリングできる", async () => {
    const { resolver, entry, name } = await openZip(await makeZipFile(""));
    expect(entry).toBe("deck.yaml");
    expect(name).toBe("proj.zip");
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect(renderSlideSvg(compiled!, 0)).toContain("ジップ");
  });

  it("サブフォルダ内の deck.yaml を root として検出する", async () => {
    const { resolver } = await openZip(await makeZipFile("myproj/"));
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect(renderSlideSvg(compiled!, 0)).toContain("ジップ");
  });

  it("書き戻し後に toBlob で再生成し、編集が永続する", async () => {
    const { resolver } = await openZip(await makeZipFile(""));
    await resolver.writeText(
      "deck.yaml",
      `theme: ./theme.yaml\nslides: [{ id: s, vars: { title: "編集後" } }]`,
    );
    const blob = await resolver.toBlob();
    const reopened = await openZip(
      new File([await blob.arrayBuffer()], "proj.zip"),
    );
    const { compiled } = await compileDeck(reopened.resolver);
    expect(renderSlideSvg(compiled!, 0)).toContain("編集後");
  });

  it("deck.yaml が無い ZIP はエラー", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hi");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(openZip(new File([bytes as BlobPart], "x.zip"))).rejects.toThrow();
  });

  it("OverrideResolver で ZIP 上の deck をライブ編集できる", async () => {
    const { resolver } = await openZip(await makeZipFile(""));
    const override = new OverrideResolver(
      resolver,
      new Map([
        [
          "deck.yaml",
          `theme: ./theme.yaml\nslides: [{ id: s, vars: { title: "上書き" } }]`,
        ],
      ]),
    );
    const { deck: mir, errors } = await recompileDeck(override);
    expect(errors).toHaveLength(0);
    const el = mir!.slides[0].elements[0] as MirText;
    expect(el.text).toBe("上書き");
  });
});
