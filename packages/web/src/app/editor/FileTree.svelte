<script lang="ts">
  import { setContext } from "svelte";
  import { store } from "../store.svelte";
  import TreeNode from "./TreeNode.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import {
    buildTree,
    flattenVisible,
    TREE_CTX,
    type TreeNode as TNode,
    type TreeCtx,
  } from "./tree";
  import {
    readDataTransferEntries,
    detectConflicts,
    uniqueName,
  } from "./file-ops";
  import { basename, dirname, join, normalize, isValidName, isDescendant } from "@slider/core";

  const tree = $derived(buildTree(store.files, store.showHidden));

  let selectedPath = $state<string | null>(null);
  let renamingPath = $state<string | null>(null);
  let menu = $state<{ node: TNode | null; x: number; y: number } | null>(null);
  let confirm = $state<{
    message: string;
    label: string;
    onConfirm: () => void;
  } | null>(null);
  let zipInput: HTMLInputElement;

  function vfs() {
    return store.vfs!;
  }

  // --- 新規作成 (デフォルト名 -> 即インライン rename) ---
  async function newFile(dir: string) {
    const name = await uniqueName(vfs(), dir, "untitled.yaml");
    await store.createFile(dir, name);
    renamingPath = normalize(join(dir, name));
  }
  async function newFolder(dir: string) {
    const name = await uniqueName(vfs(), dir, "new-folder");
    await store.createFolder(dir, name);
    renamingPath = normalize(join(dir, name));
  }

  async function uploadFiles(items: DataTransferItemList, toDir: string) {
    const entries = await readDataTransferEntries(items);
    if (entries.length === 0) return;
    const conflicts = await detectConflicts(
      vfs(),
      toDir,
      entries.map((e) => e.path),
    );
    if (conflicts.length > 0) {
      confirm = {
        message:
          "次のファイルが既に存在します:\n" +
          conflicts.map((c) => " - " + c).join("\n"),
        label: `上書き (${conflicts.length}件)`,
        onConfirm: () => void store.uploadEntries(toDir, entries, true),
      };
    } else {
      await store.uploadEntries(toDir, entries, false);
    }
  }

  function confirmDelete(node: TNode) {
    if (node.kind === "file") {
      confirm = {
        message: `'${node.name}' を削除しますか?`,
        label: "削除",
        onConfirm: () => void store.deletePath(node.path),
      };
    } else {
      const count = store.files.filter(
        (f) => f.kind === "file" && isDescendant(f.path, node.path),
      ).length;
      confirm = {
        message: `'${node.name}/' を中身ごと削除しますか? (${count} 個のファイル)`,
        label: "削除",
        onConfirm: () => void store.deletePath(node.path),
      };
    }
  }

  // TreeNode へ渡すコントローラ。
  const ctx: TreeCtx = {
    selected: () => selectedPath,
    select: (node) => {
      selectedPath = node.path;
      if (node.kind === "file") void store.openFile(node.path);
    },
    renaming: () => renamingPath,
    startRename: (path) => (renamingPath = path),
    cancelRename: () => (renamingPath = null),
    submitRename: (path, name) => {
      renamingPath = null;
      if (name && name !== basename(path) && isValidName(name)) {
        void store.renamePath(path, name);
      }
    },
    openMenu: (node, x, y) => (menu = { node, x, y }),
    dropMove: (from, toDir) => void store.moveNode(from, toDir),
    dropUpload: (items, toDir) => void uploadFiles(items, toDir),
  };
  setContext(TREE_CTX, ctx);

  function menuItems(node: TNode | null): MenuItem[] {
    if (node === null) {
      return [
        { label: "新規ファイル", action: () => void newFile("/") },
        { label: "新規フォルダ", action: () => void newFolder("/") },
        { label: "ZIP インポート", action: () => zipInput.click() },
        { label: "ZIP エクスポート", action: () => void store.exportZip() },
      ];
    }
    if (node.kind === "folder") {
      return [
        { label: "新規ファイル", action: () => void newFile(node.path) },
        { label: "新規フォルダ", action: () => void newFolder(node.path) },
        { label: "リネーム", action: () => (renamingPath = node.path) },
        { label: "削除", danger: true, action: () => confirmDelete(node) },
      ];
    }
    return [
      { label: "開く", action: () => void store.openFile(node.path) },
      { label: "リネーム", action: () => (renamingPath = node.path) },
      { label: "複製", action: () => void store.duplicatePath(node.path) },
      { label: "ダウンロード", action: () => void store.downloadFile(node.path) },
      { label: "削除", danger: true, action: () => confirmDelete(node) },
    ];
  }

  // --- キーボード操作 (§8.1) ---
  function onKey(e: KeyboardEvent) {
    if (renamingPath) return;
    const list = flattenVisible(tree, store.expanded);
    const idx = list.findIndex((n) => n.path === selectedPath);
    const cur = idx >= 0 ? list[idx] : undefined;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (list[idx + 1]) selectedPath = list[idx + 1].path;
        else if (idx < 0 && list[0]) selectedPath = list[0].path;
        break;
      case "ArrowUp":
        e.preventDefault();
        if (list[idx - 1]) selectedPath = list[idx - 1].path;
        break;
      case "ArrowRight":
        if (cur?.kind === "folder")
          store.isExpanded(cur.path)
            ? cur.children[0] && (selectedPath = cur.children[0].path)
            : store.setExpanded(cur.path, true);
        break;
      case "ArrowLeft":
        if (cur?.kind === "folder" && store.isExpanded(cur.path))
          store.setExpanded(cur.path, false);
        else if (cur) selectedPath = dirname(cur.path);
        break;
      case "Enter":
        if (cur?.kind === "folder") store.toggleExpanded(cur.path);
        else if (cur) void store.openFile(cur.path);
        break;
      case "F2":
        if (cur) renamingPath = cur.path;
        break;
      case "Delete":
      case "Backspace":
        if (cur) confirmDelete(cur);
        break;
      case "Escape":
        selectedPath = null;
        break;
    }
  }

  async function onZipPicked(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await store.importZip(file);
    (e.target as HTMLInputElement).value = "";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="filetree"
  tabindex="0"
  role="tree"
  onkeydown={onKey}
  oncontextmenu={(e) => {
    e.preventDefault();
    // 開いた直後に同じイベントが window まで伝播して ContextMenu を
    // 即閉じするのを防ぐ (TreeNode 側と同様)。
    e.stopPropagation();
    menu = { node: null, x: e.clientX, y: e.clientY };
  }}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => {
    e.preventDefault();
    const from = e.dataTransfer?.getData("application/x-vfs-path");
    if (from) store.moveNode(from, "/");
    else if (e.dataTransfer?.items.length) void uploadFiles(e.dataTransfer.items, "/");
  }}
>
  <header>
    <span>ファイル</span>
    <span class="actions">
      <button title="新規ファイル" onclick={() => newFile("/")}>＋</button>
      <button
        title="隠しファイル表示"
        class:on={store.showHidden}
        onclick={() => store.toggleHidden()}>•</button
      >
    </span>
  </header>

  <div class="body">
    {#each tree as node (node.path)}
      <TreeNode {node} depth={0} />
    {/each}
  </div>

  <input
    bind:this={zipInput}
    type="file"
    accept=".zip"
    hidden
    onchange={onZipPicked}
  />
</div>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menuItems(menu.node)}
    onClose={() => (menu = null)}
  />
{/if}

{#if confirm}
  <ConfirmDialog
    message={confirm.message}
    confirmLabel={confirm.label}
    danger
    onConfirm={() => {
      confirm?.onConfirm();
      confirm = null;
    }}
    onCancel={() => (confirm = null)}
  />
{/if}

<style>
  .filetree {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--bg-2);
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-dim);
    border-bottom: 1px solid var(--border);
  }
  .actions button {
    padding: 2px 7px;
    font-size: 0.85rem;
    line-height: 1;
  }
  .actions button.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }
</style>
