import type { VFS } from "../vfs";
import { mimeFromPath } from "@slideck/core";

interface Manifest {
  files: string[];
}

// Fetch files under public/examples/basic and write them to the VFS (install sample).
export async function installSample(vfs: VFS, baseUrl: string): Promise<void> {
  const manifest: Manifest = await (await fetch(`${baseUrl}manifest.json`)).json();
  for (const rel of manifest.files) {
    const res = await fetch(`${baseUrl}${rel}`);
    if (!res.ok) throw new Error(`Failed to fetch sample: ${rel} (${res.status})`);
    const blob = await res.blob();
    await vfs.writeBlob("/" + rel, blob, mimeFromPath(rel));
  }
}

const EMPTY_DECK = `bases:
  - id: base
    always: true
    file: ./theme-base.yaml

slides:
  - id: slide-1
    vars:
      title: Title
`;

const EMPTY_BASE = `# Minimal theme base
# colors are injected as variables (referenced via \${bg} etc.).
colors:
  bg: "#16161e"
  fg: "#c0caf5"
slide: { width: 1920, height: 1080 }
background: \${bg}
defaults:
  text: { size: 48, color: "\${fg}" }
schema:
  vars:
    title: { type: string, required: true }
layout:
  - type: text
    position: { left: center, top: 40%, width: 90% }
    align: center
    size: 96
    text: \${title}
`;

// Write only a minimal deck.yaml and theme-base.yaml.
export async function createEmptyProject(vfs: VFS): Promise<void> {
  await vfs.writeText("/deck.yaml", EMPTY_DECK);
  await vfs.writeText("/theme-base.yaml", EMPTY_BASE);
}

// Copy every file (and folder) from one project's VFS into another. Project meta
// (e.g. the GitHub remote/baseline) is intentionally not copied, so a project
// created from a template does not inherit the template's repository settings.
export async function copyProjectFiles(src: VFS, dest: VFS): Promise<void> {
  const entries = await src.list();
  for (const e of entries) if (e.kind === "folder") await dest.createFolder(e.path);
  for (const e of entries) {
    if (e.kind !== "file") continue;
    await dest.writeBlob(e.path, await src.readBlob(e.path), e.mimeType);
  }
}
