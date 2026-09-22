import type { VFSEvent, VFS } from "@slideck/core";
import { openHttpVfs, openVfs, probeServer } from "../../vfs";
import {
  dbNameFor,
  getLastProject,
  listProjects,
  listTemplates,
  projectExists as registryProjectExists,
  registerProject,
  setLastProject,
  setTemplate,
  unregisterProject,
  type ProjectMeta,
} from "../projects";
import { copyProjectFiles, installSample } from "../sample";

export const ENTRY = "/deck.yaml";

type BootListener = () => Promise<void> | void;
type ProjectLoadedListener = (autoPull: boolean) => Promise<void> | void;
type VfsEventListener = (event: VFSEvent) => void;

let booting = $state(true);
let ready = $state(false);
let serverMode = $state(false);
let currentProject = $state<string | null>(null);
let projectsVersion = $state(0);

let currentVfs: VFS | null = null;
let unsubscribe: (() => void) | null = null;
const bootListeners = new Set<BootListener>();
const projectLoadListeners = new Set<ProjectLoadedListener>();
const projectReadyListeners = new Set<ProjectLoadedListener>();
const vfsEventListeners = new Set<VfsEventListener>();

export function isBooting(): boolean {
  return booting;
}

export function isReady(): boolean {
  return ready;
}

export function isServerMode(): boolean {
  return serverMode;
}

export function projectName(): string | null {
  return currentProject;
}

export function vfs(): VFS | null {
  return currentVfs;
}

export function requireVfs(): VFS {
  if (!currentVfs) throw new Error("VFS not initialized");
  return currentVfs;
}

export function projects(): ProjectMeta[] {
  void projectsVersion;
  return listProjects();
}

export function templates(): ProjectMeta[] {
  void projectsVersion;
  return listTemplates();
}

export function markTemplate(name: string): void {
  setTemplate(name, true);
  projectsVersion++;
}

export function unmarkTemplate(name: string): void {
  setTemplate(name, false);
  projectsVersion++;
}

export function projectExists(name: string): boolean {
  return registryProjectExists(name);
}

export function onBoot(listener: BootListener): () => void {
  bootListeners.add(listener);
  return () => bootListeners.delete(listener);
}

export function onProjectLoaded(listener: ProjectLoadedListener, afterReady = false): () => void {
  const listeners = afterReady ? projectReadyListeners : projectLoadListeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onVfsEvent(listener: VfsEventListener): () => void {
  vfsEventListeners.add(listener);
  return () => vfsEventListeners.delete(listener);
}

function disposeVfs(): void {
  unsubscribe?.();
  unsubscribe = null;
  currentVfs?.dispose();
  currentVfs = null;
}

export async function useVfs(name: string): Promise<void> {
  disposeVfs();
  currentVfs = await openVfs(dbNameFor(name));
  currentProject = name;
  setLastProject(name);
}

async function loadCurrentProject(autoPull = false): Promise<void> {
  if (!currentVfs) return;
  unsubscribe?.();
  unsubscribe = currentVfs.subscribe((event) => {
    for (const listener of vfsEventListeners) listener(event);
  });
  for (const listener of projectLoadListeners) await listener(autoPull);
  ready = true;
  for (const listener of projectReadyListeners) await listener(autoPull);
}

export async function boot(): Promise<void> {
  for (const listener of bootListeners) await listener();
  const info = await probeServer();
  if (info) {
    serverMode = true;
    disposeVfs();
    currentVfs = openHttpVfs();
    currentProject = info.name;
    await loadCurrentProject();
    booting = false;
    return;
  }
  void navigator.storage?.persist?.();
  const last = getLastProject();
  if (last && registryProjectExists(last)) {
    await useVfs(last);
    await loadCurrentProject(true);
  }
  booting = false;
}

export async function openProject(name: string): Promise<void> {
  if (!registryProjectExists(name)) throw new Error(`Project "${name}" does not exist`);
  ready = false;
  await useVfs(name);
  await loadCurrentProject(true);
}

export async function createProject(
  name: string,
  init: (vfs: VFS) => Promise<void>,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Please enter a project name");
  if (registryProjectExists(trimmed)) {
    throw new Error(`Project "${trimmed}" already exists`);
  }
  ready = false;
  await useVfs(trimmed);
  await init(requireVfs());
  registerProject(trimmed);
  projectsVersion++;
  await loadCurrentProject();
}

export async function createFromTemplate(
  name: string,
  template: { sample: boolean; name?: string },
): Promise<void> {
  await createProject(name, async (dest) => {
    if (template.sample) {
      await installSample(dest, `${import.meta.env.BASE_URL}examples/basic/`);
    } else if (template.name) {
      const src = await openVfs(dbNameFor(template.name));
      try {
        await copyProjectFiles(src, dest);
      } finally {
        src.dispose();
      }
    }
  });
}

export async function deleteProject(name: string): Promise<void> {
  if (currentProject === name) {
    disposeVfs();
    currentProject = null;
    ready = false;
  }
  unregisterProject(name);
  projectsVersion++;
  indexedDB.deleteDatabase(dbNameFor(name));
}
