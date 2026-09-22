// Tree traversal shared by every pass that visits elements. group children and
// ul/ol items are the only nesting constructs, so this is the single place that
// knows about them; passes must not re-implement the recursion. Generic over
// the element union so it serves both HIR and MIR.
export interface ElementTree<T> {
  // Every element has a type tag; it also keeps this from being a weak type.
  type: string;
  children?: T[];
  items?: T[];
}

// Direct children of an element ([] for leaves).
export function childElements<T extends ElementTree<T>>(el: T): T[] {
  return el.children ?? el.items ?? [];
}

// Depth-first pre-order visit of every element in the forest.
export function walkElements<T extends ElementTree<T>>(els: T[], visit: (el: T) => void): void {
  for (const el of els) {
    visit(el);
    walkElements(childElements(el), visit);
  }
}
