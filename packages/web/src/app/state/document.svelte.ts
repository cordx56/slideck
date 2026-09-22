import {
  debounce,
  extname,
  isDescendant,
  isImagePath,
  isTextPath,
  slideRangesOf,
} from "@slideck/core";
import * as files from "./files.svelte";
import * as project from "./project.svelte";

type DocumentListener = () => void;

let openPath = $state(project.ENTRY);
let yamlText = $state("");
let dirty = $state(false);
let slideRanges = $state.raw<Array<[number, number]>>([]);
let currentSlide = $state(0);
let editorCursorTarget = $state<number | null>(null);
let selfSaving = false;
let slideCountProvider = () => 0;

const yamlChangedListeners = new Set<DocumentListener>();
const documentChangedListeners = new Set<DocumentListener>();
const savedListeners = new Set<DocumentListener>();

function isYaml(path: string): boolean {
  const extension = extname(path);
  return extension === ".yaml" || extension === ".yml";
}

function isText(path: string): boolean {
  return isTextPath(path);
}

export function path(): string {
  return openPath;
}

export function text(): string {
  return yamlText;
}

export function isDirty(): boolean {
  return dirty;
}

export function slideRangeList(): Array<[number, number]> {
  return slideRanges;
}

export function slide(): number {
  return currentSlide;
}

export function setCurrentSlide(value: number): void {
  currentSlide = value;
}

export function cursorTarget(): number | null {
  return editorCursorTarget;
}

export function setCursorTarget(value: number | null): void {
  editorCursorTarget = value;
}

export function isYamlOpen(): boolean {
  return isYaml(openPath);
}

export function isTextOpen(): boolean {
  return isText(openPath);
}

export function isImageOpen(): boolean {
  return isImagePath(openPath);
}

export function isSelfSaving(): boolean {
  return selfSaving;
}

export function setSlideCountProvider(provider: () => number): void {
  slideCountProvider = provider;
}

export function onYamlChanged(listener: DocumentListener): () => void {
  yamlChangedListeners.add(listener);
  return () => yamlChangedListeners.delete(listener);
}

export function onDocumentChanged(listener: DocumentListener): () => void {
  documentChangedListeners.add(listener);
  return () => documentChangedListeners.delete(listener);
}

export function onSaved(listener: DocumentListener): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

export function refreshSlideRanges(): void {
  slideRanges = openPath === project.ENTRY ? slideRangesOf(yamlText) : [];
}

export function slideAtOffset(offset: number): number | null {
  if (slideRanges.length === 0 || offset < slideRanges[0][0]) return null;
  for (let index = 0; index < slideRanges.length; index++) {
    const [start, end] = slideRanges[index];
    if (offset >= start && offset < end) return index;
  }
  return slideRanges.length - 1;
}

export async function saveCurrent(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || !dirty || !isText(openPath)) return;
  selfSaving = true;
  try {
    await vfs.writeText(openPath, yamlText);
    dirty = false;
    for (const listener of savedListeners) listener();
  } catch {
    // Keep dirty so a later save retries; do not break the update loop.
  } finally {
    selfSaving = false;
  }
}

const scheduleSave = debounce(() => void saveCurrent(), 400);

export function applyYaml(value: string): void {
  yamlText = value;
  dirty = true;
  if (isYaml(openPath)) {
    refreshSlideRanges();
    for (const listener of yamlChangedListeners) listener();
  }
  scheduleSave();
  for (const listener of documentChangedListeners) listener();
}

export function setYaml(value: string): void {
  applyYaml(value);
}

export async function openFile(path: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  if (dirty && isText(openPath)) await saveCurrent();
  openPath = path;
  yamlText = isText(path) ? await vfs.readText(path) : "";
  dirty = false;
  refreshSlideRanges();
}

export async function save(): Promise<void> {
  await saveCurrent();
}

export function goSlide(index: number, options?: { moveCursor?: boolean }): void {
  const next = Math.max(0, Math.min(slideCountProvider() - 1, index));
  currentSlide = next;
  if (options?.moveCursor) {
    const start = slideRanges[next]?.[0];
    if (start !== undefined) editorCursorTarget = start;
  }
}

export function next(): void {
  goSlide(currentSlide + 1, { moveCursor: true });
}

export function prev(): void {
  goSlide(currentSlide - 1, { moveCursor: true });
}

export function cursorMoved(offset: number): void {
  const index = slideAtOffset(offset);
  if (index !== null && index !== currentSlide) currentSlide = index;
}

export async function reloadOpen(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  yamlText =
    isText(openPath) && (await vfs.exists(openPath)) ? await vfs.readText(openPath) : yamlText;
  dirty = false;
  refreshSlideRanges();
  await files.refreshFiles();
}

project.onProjectLoaded(async () => {
  const vfs = project.requireVfs();
  openPath = project.ENTRY;
  yamlText = (await vfs.exists(project.ENTRY)) ? await vfs.readText(project.ENTRY) : "";
  dirty = false;
  currentSlide = 0;
  refreshSlideRanges();
});

files.onOpenPathInvalidated(async (event) => {
  if (event.type === "open") {
    await openFile(event.path);
  } else if (event.type === "move") {
    if (openPath === event.from) await openFile(event.to);
    else if (isDescendant(openPath, event.from)) {
      await openFile(event.to + openPath.slice(event.from.length));
    }
  } else if (openPath === event.path || isDescendant(openPath, event.path)) {
    const vfs = project.requireVfs();
    if (await vfs.exists(project.ENTRY)) await openFile(project.ENTRY);
    else {
      openPath = "/";
      yamlText = "";
      dirty = false;
      refreshSlideRanges();
    }
  }
});
