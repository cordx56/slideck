import type { TextDefaults, LinkDefaults, MonoDefaults } from "../ir/hir";
import type { AppliedBase } from "./bases";

export interface MergedDefaults {
  text: TextDefaults;
  link: LinkDefaults;
  mono: MonoDefaults;
}

// 適用 base の defaults を順に深いマージする (後勝ち)。
export function mergeDefaults(applied: AppliedBase[]): MergedDefaults {
  let text: TextDefaults = {};
  let link: LinkDefaults = {};
  let mono: MonoDefaults = {};
  for (const { base } of applied) {
    text = { ...text, ...base.defaults?.text };
    link = { ...link, ...base.defaults?.link };
    mono = { ...mono, ...base.defaults?.mono };
  }
  return { text, link, mono };
}
