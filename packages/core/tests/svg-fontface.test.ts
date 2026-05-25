import { describe, it, expect } from "vitest";
import { renderSvgString } from "../src/render/svg";

const slide = { id: "s", width: 1000, height: 1000, primitives: [] };

describe("renderSvgString @font-face sanitization", () => {
  it("strips characters that could break out of the CSS string / <style>", () => {
    const svg = renderSvgString(slide, {
      fontFaces: [
        {
          family: 'Noto"; } </style><image onerror=alert(1)>',
          dataUrl: "data:font/ttf;base64,AAAA",
          weight: 700,
          style: "italic",
          format: "truetype",
        },
      ],
    });
    // Only one legitimate closing tag; the style body has no markup or attribute syntax.
    expect(svg.match(/<\/style>/g) ?? []).toHaveLength(1);
    expect(svg).not.toContain("<image");
    const style = svg.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? "";
    expect(style).not.toContain("<"); // no tag can be opened
    expect(style).not.toContain("="); // no attribute (e.g. onerror=) can form
    expect(style).toContain("font-weight:700;font-style:italic;");
    expect(style).toContain('src:url(data:font/ttf;base64,AAAA) format("truetype");');
  });

  it("drops the src for a non-data: URL and ignores an unknown format", () => {
    const svg = renderSvgString(slide, {
      fontFaces: [{ family: "X", dataUrl: "https://evil.example/x.ttf)", format: "exe" }],
    });
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("evil.example");
  });

  it("ignores non-numeric weight and invalid style", () => {
    const svg = renderSvgString(slide, {
      fontFaces: [
        {
          family: "X",
          dataUrl: "data:font/ttf;base64,AAAA",
          weight: Number.NaN,
          style: "oblique" as unknown as "normal",
        },
      ],
    });
    expect(svg).toContain('@font-face{font-family:"X";src:url(data:font/ttf;base64,AAAA);}');
    expect(svg).not.toContain("font-weight");
    expect(svg).not.toContain("font-style");
  });
});
