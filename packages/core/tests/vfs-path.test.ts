import { describe, it, expect } from "vitest";
import {
  normalize,
  dirname,
  basename,
  extname,
  resolvePath,
  isDescendant,
  isValidName,
} from "../src/path";

describe("vfs/path normalize", () => {
  it("collapses . and .. and slashes", () => {
    expect(normalize("/a/./b//c")).toBe("/a/b/c");
    expect(normalize("/a/b/../c")).toBe("/a/c");
    expect(normalize("/")).toBe("/");
    expect(normalize("/a/")).toBe("/a");
  });

  it("escaping the root is an error", () => {
    expect(() => normalize("/../foo")).toThrow();
    expect(() => normalize("/a/../../b")).toThrow();
  });
});

describe("vfs/path dirname & basename", () => {
  it("dirname", () => {
    expect(dirname("/img/fig1.png")).toBe("/img");
    expect(dirname("/deck.yaml")).toBe("/");
    expect(dirname("/img")).toBe("/");
    expect(dirname("/")).toBe("/");
  });
  it("basename / extname", () => {
    expect(basename("/img/fig1.png")).toBe("fig1.png");
    expect(extname("/img/fig1.PNG")).toBe(".png");
    expect(extname("/.gitignore")).toBe("");
    expect(extname("/x")).toBe("");
  });
});

describe("vfs/path resolvePath (3 forms of YAML reference)", () => {
  it("absolute reference", () => {
    expect(resolvePath("/img/x.png", "/sub/theme.yaml")).toBe("/img/x.png");
  });
  it("same-directory reference name.ext", () => {
    expect(resolvePath("x.png", "/sub/theme.yaml")).toBe("/sub/x.png");
  });
  it("./ relative reference", () => {
    expect(resolvePath("./img/x.png", "/sub/theme.yaml")).toBe("/sub/img/x.png");
  });
  it("../ relative reference", () => {
    expect(resolvePath("../img/x.png", "/sub/theme.yaml")).toBe("/img/x.png");
  });
  it("escaping the root is an error", () => {
    expect(() => resolvePath("../../x", "/sub/theme.yaml")).toThrow();
  });
});

describe("vfs/path misc", () => {
  it("isDescendant", () => {
    expect(isDescendant("/img/a.png", "/img")).toBe(true);
    expect(isDescendant("/img", "/img")).toBe(false);
    expect(isDescendant("/a.png", "/")).toBe(true);
  });
  it("isValidName", () => {
    expect(isValidName("fig 1.png")).toBe(true);
    expect(isValidName("画像.png")).toBe(true);
    expect(isValidName("a/b")).toBe(false);
    expect(isValidName("a:b")).toBe(false);
    expect(isValidName("..")).toBe(false);
    expect(isValidName("")).toBe(false);
  });
});
