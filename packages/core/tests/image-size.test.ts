import { describe, it, expect } from "vitest";
import { imageSize } from "../src/lib/image-size";

const enc = (s: string) => new TextEncoder().encode(s);

describe("imageSize for SVG", () => {
  it("reads dimensions from viewBox (used as the intrinsic aspect)", () => {
    const svg = enc(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"/>`);
    expect(imageSize(svg)).toEqual({ width: 320, height: 200 });
  });

  it("falls back to width/height attributes (any absolute unit)", () => {
    expect(imageSize(enc(`<svg width="128" height="64"></svg>`))).toEqual({ width: 128, height: 64 });
    expect(imageSize(enc(`<svg width="10px" height="20pt"/>`))).toEqual({ width: 10, height: 20 });
  });

  it("viewBox wins over width/height when both are present", () => {
    const svg = enc(`<svg width="100" height="100" viewBox="0 0 50 25"/>`);
    expect(imageSize(svg)).toEqual({ width: 50, height: 25 });
  });

  it("returns {0,0} when only relative (%) sizes are given (no usable aspect)", () => {
    expect(imageSize(enc(`<svg width="100%" height="100%"/>`))).toEqual({ width: 0, height: 0 });
  });

  it("returns {0,0} for a non-SVG bytestream", () => {
    expect(imageSize(enc("not an svg"))).toEqual({ width: 0, height: 0 });
  });

  it("ignores comma/whitespace mix in viewBox", () => {
    expect(imageSize(enc(`<svg viewBox=" 0,0 , 800 ,  400 "/>`))).toEqual({
      width: 800,
      height: 400,
    });
  });
});
