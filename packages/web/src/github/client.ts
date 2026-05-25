// Minimal GitHub REST client (api.github.com supports CORS with a bearer token).
const API = "https://api.github.com";

// Encode every URL path segment derived from user input.
const enc = encodeURIComponent;

// GitHub naming rules: owner (login) is <=39 chars, alphanumeric with single
// internal hyphens; repo is <=100 chars of [A-Za-z0-9._-].
const OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
export const isValidOwner = (s: string): boolean => OWNER_RE.test(s);
export const isValidRepo = (s: string): boolean => REPO_RE.test(s);

// Parse "owner/repo", validating both names. Returns null when malformed.
export function parseRepoPath(input: string): { owner: string; repo: string } | null {
  const m = input.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const [, owner, repo] = m;
  return isValidOwner(owner) && isValidRepo(repo) ? { owner, repo } : null;
}

export interface Repo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  updated_at: string;
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree" | "commit";
  size?: number; // blob byte size (used for clone/pull preflight limits)
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// --- base64 (binary-safe) ---
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Reads ---
export async function getUser(token: string): Promise<{ login: string }> {
  return gh(token, "/user");
}

export async function listRepos(token: string): Promise<Repo[]> {
  return gh(
    token,
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );
}

export async function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  return gh(token, `/repos/${enc(owner)}/${enc(repo)}`);
}

// Recursive blob list of a ref. Throws if the tree is truncated (too large).
export async function listTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<TreeEntry[]> {
  const res = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(branch)}?recursive=1`,
  );
  if (res.truncated) throw new Error("repository tree is too large (truncated)");
  return res.tree.filter((e) => e.type === "blob");
}

export async function getBlob(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<Uint8Array> {
  const res = await gh<{ content: string; encoding: string }>(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/blobs/${enc(sha)}`,
  );
  return base64ToBytes(res.content);
}

// Date of the last commit touching a path (for conflict "newer wins").
export async function lastCommitDate(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<number | undefined> {
  const res = await gh<{ commit: { committer: { date: string } } }[]>(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/commits?sha=${enc(branch)}&path=${enc(path)}&per_page=1`,
  );
  const date = res[0]?.commit.committer.date;
  return date ? Date.parse(date) : undefined;
}

// --- Write (Git Data API: one commit for many files) ---
export interface TreeChange {
  path: string;
  sha?: string | null; // null deletes; otherwise the new blob sha
}

export async function getHeadCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ commit: string; tree: string }> {
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`,
  );
  const commit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/commits/${enc(ref.object.sha)}`,
  );
  return { commit: ref.object.sha, tree: commit.tree.sha };
}

export async function createBlob(
  token: string,
  owner: string,
  repo: string,
  bytes: Uint8Array,
): Promise<string> {
  const res = await gh<{ sha: string }>(token, `/repos/${enc(owner)}/${enc(repo)}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: bytesToBase64(bytes), encoding: "base64" }),
  });
  return res.sha;
}

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  changes: TreeChange[],
): Promise<string> {
  const tree = changes.map((c) => ({ path: c.path, mode: "100644", type: "blob", sha: c.sha }));
  const res = await gh<{ sha: string }>(token, `/repos/${enc(owner)}/${enc(repo)}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  return res.sha;
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parent: string,
): Promise<string> {
  const res = await gh<{ sha: string }>(token, `/repos/${enc(owner)}/${enc(repo)}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree, parents: [parent] }),
  });
  return res.sha;
}

export async function updateBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  commit: string,
): Promise<void> {
  await gh(token, `/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit }),
  });
}
