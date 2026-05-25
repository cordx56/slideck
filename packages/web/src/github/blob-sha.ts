// Git blob SHA-1: sha1("blob " + byteLength + "\0" + bytes). Lets us detect
// per-file changes against the tree shas GitHub returns without downloading blobs.
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
