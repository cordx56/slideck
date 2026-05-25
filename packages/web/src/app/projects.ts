// Project registry. Each project's actual files are stored in a per-name
// IndexedDB database (dbNameFor). Here we keep a lightweight index of the
// name list (and the last opened name) in localStorage.

export interface ProjectMeta {
  name: string;
  createdAt: number;
  // A template project: usable in "Create from template" while still being a
  // normal, openable project.
  isTemplate?: boolean;
}

const LIST_KEY = "slideck:projects";
const LAST_KEY = "slideck:lastProject";

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

// Return sorted newest first.
export function listProjects(): ProjectMeta[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function projectExists(name: string): boolean {
  return read().some((p) => p.name === name);
}

// Projects flagged as templates, newest first.
export function listTemplates(): ProjectMeta[] {
  return read()
    .filter((p) => p.isTemplate)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function setTemplate(name: string, isTemplate: boolean): void {
  const list = read();
  const p = list.find((x) => x.name === name);
  if (!p) return;
  if (isTemplate) p.isTemplate = true;
  else delete p.isTemplate;
  write(list);
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

// Project name -> IndexedDB database name.
export function dbNameFor(name: string): string {
  return `slideck-proj:${name}`;
}

export function getLastProject(): string | null {
  return ls()?.getItem(LAST_KEY) ?? null;
}

export function setLastProject(name: string): void {
  ls()?.setItem(LAST_KEY, name);
}
