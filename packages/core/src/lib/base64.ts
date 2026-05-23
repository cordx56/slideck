// Encode a byte array to base64. Works in both the browser (btoa) and Node.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // avoid call stack overflow on large arrays
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback
  return Buffer.from(binary, "binary").toString("base64");
}

export function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
