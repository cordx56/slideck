// バイト列を base64 化する。ブラウザ (btoa) と Node の両方で動く。
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // 大きい配列での call stack 溢れを防ぐ
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node フォールバック
  return Buffer.from(binary, "binary").toString("base64");
}

export function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
