export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}
