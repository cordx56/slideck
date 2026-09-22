// CSS and browsers use about 14 degrees for synthetic italic. Skewing leaves
// horizontal advance unchanged, so measured layout remains consistent.
export const ITALIC_SKEW = Math.tan((14 * Math.PI) / 180);
