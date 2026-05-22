import type { TextDefaults } from "../ir/hir";
import type { AppliedBase } from "./bases";

export interface MergedDefaults {
  text: TextDefaults;
}

// 適用 base の defaults を順に深いマージする (後勝ち)。
// 現状は defaults.text のみ。将来 image 等を追加する場合もここで合成する。
export function mergeDefaults(applied: AppliedBase[]): MergedDefaults {
  let text: TextDefaults = {};
  for (const { base } of applied) {
    text = { ...text, ...base.defaults?.text };
  }
  return { text };
}
