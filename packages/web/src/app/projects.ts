// プロジェクトのレジストリ。各プロジェクトのファイル実体は
// 名前別の IndexedDB データベース (dbNameFor) に保存する。ここでは名前一覧
// (と最後に開いた名前) を localStorage で管理する軽量インデックス。

export interface ProjectMeta {
  name: string;
  createdAt: number;
}

const LIST_KEY = "slider:projects";
const LAST_KEY = "slider:lastProject";

function ls(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function read(): ProjectMeta[] {
  try {
    return JSON.parse(ls()?.getItem(LIST_KEY) ?? "[]") as ProjectMeta[];
  } catch {
    return [];
  }
}

function write(list: ProjectMeta[]): void {
  ls()?.setItem(LIST_KEY, JSON.stringify(list));
}

// 新しい順に並べて返す。
export function listProjects(): ProjectMeta[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function projectExists(name: string): boolean {
  return read().some((p) => p.name === name);
}

export function registerProject(name: string): void {
  const list = read();
  if (!list.some((p) => p.name === name)) {
    list.push({ name, createdAt: Date.now() });
    write(list);
  }
}

export function unregisterProject(name: string): void {
  write(read().filter((p) => p.name !== name));
  if (getLastProject() === name) ls()?.removeItem(LAST_KEY);
}

// プロジェクト名 -> IndexedDB データベース名。
export function dbNameFor(name: string): string {
  return `slider-proj:${name}`;
}

export function getLastProject(): string | null {
  return ls()?.getItem(LAST_KEY) ?? null;
}

export function setLastProject(name: string): void {
  ls()?.setItem(LAST_KEY, name);
}
