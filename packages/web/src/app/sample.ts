import type { VFS } from "../vfs";
import { mimeFromPath } from "@slideck/core";

interface Manifest {
  files: string[];
}

// public/examples/basic 以下を fetch して VFS に書き込む (サンプル投入)。
export async function installSample(vfs: VFS, baseUrl: string): Promise<void> {
  const manifest: Manifest = await (await fetch(`${baseUrl}manifest.json`)).json();
  for (const rel of manifest.files) {
    const res = await fetch(`${baseUrl}${rel}`);
    if (!res.ok) throw new Error(`サンプル取得失敗: ${rel} (${res.status})`);
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
      title: タイトル
`;

const EMPTY_BASE = `# 最小テーマ base
# colors は変数として注入される (\${bg} 等で参照)。
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

// 最小限の deck.yaml と theme-base.yaml だけ書き込む。
export async function createEmptyProject(vfs: VFS): Promise<void> {
  await vfs.writeText("/deck.yaml", EMPTY_DECK);
  await vfs.writeText("/theme-base.yaml", EMPTY_BASE);
}
