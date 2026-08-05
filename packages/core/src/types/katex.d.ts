import "katex";

declare module "katex" {
  export interface KatexInternalStyle {
    backgroundColor?: string;
    borderBottomWidth?: string;
    borderColor?: string;
    borderRightWidth?: string;
    borderTopWidth?: string;
    borderWidth?: string;
    bottom?: string;
    color?: string;
    height?: string;
    left?: string;
    margin?: string;
    marginLeft?: string;
    marginRight?: string;
    marginTop?: string;
    minWidth?: string;
    paddingLeft?: string;
    position?: string;
    top?: string;
    verticalAlign?: string;
    width?: string;
  }

  export interface KatexInternalNode {
    children?: KatexInternalNode[];
    classes?: string[];
    attributes?: Record<string, string>;
    style?: KatexInternalStyle;
    text?: string;
    height?: number;
    depth?: number;
    italic?: number;
    width?: number;
    pathName?: string;
    alternate?: string | null;
    toMarkup(): string;
  }

  export function __renderToHTMLTree(expression: string, options: KatexOptions): KatexInternalNode;
}
