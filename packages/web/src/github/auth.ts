import { openDB, type IDBPDatabase } from "idb";

// GitHub auth lives in its own (app-global, not per-project) IndexedDB.
// Authentication is a fine-grained Personal Access Token (Contents read/write).
const DB = "slideck-github";

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB, 1, {
      upgrade(d) {
        d.createObjectStore("kv");
      },
    });
  }
  return dbp;
}

export interface GithubAuth {
  token: string;
  login: string;
}

export async function loadAuth(): Promise<GithubAuth | null> {
  const d = await db();
  const token = (await d.get("kv", "token")) as string | undefined;
  const login = (await d.get("kv", "login")) as string | undefined;
  return token && login ? { token, login } : null;
}

export async function saveAuth(auth: GithubAuth): Promise<void> {
  const d = await db();
  await d.put("kv", auth.token, "token");
  await d.put("kv", auth.login, "login");
}

export async function clearAuth(): Promise<void> {
  const d = await db();
  await d.delete("kv", "token");
  await d.delete("kv", "login");
}
