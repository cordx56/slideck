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
  import { basename, dirname, join, normalize, isValidName, isDescendant } from "@slideck/core";

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

  // --- Create new (default name -> immediate inline rename) ---
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
          "The following files already exist:\n" +
          conflicts.map((c) => " - " + c).join("\n"),
        label: `Overwrite (${conflicts.length})`,
        onConfirm: () => void store.uploadEntries(toDir, entries, true),
      };
    } else {
      await store.uploadEntries(toDir, entries, false);
    }
  }

  function confirmDelete(node: TNode) {
    if (node.kind === "file") {
      confirm = {
        message: `Delete '${node.name}'?`,
        label: "Delete",
        onConfirm: () => void store.deletePath(node.path),
      };
    } else {
      const count = store.files.filter(
        (f) => f.kind === "file" && isDescendant(f.path, node.path),
      ).length;
      confirm = {
        message: `Delete '${node.name}/' and all its contents? (${count} files)`,
        label: "Delete",
        onConfirm: () => void store.deletePath(node.path),
      };
    }
  }

  // Controller passed to TreeNode.
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
        { label: "New file", action: () => void newFile("/") },
        { label: "New folder", action: () => void newFolder("/") },
        { label: "Import ZIP", action: () => zipInput.click() },
        { label: "Export ZIP", action: () => void store.exportZip() },
      ];
    }
    if (node.kind === "folder") {
      return [
        { label: "New file", action: () => void newFile(node.path) },
        { label: "New folder", action: () => void newFolder(node.path) },
        { label: "Rename", action: () => (renamingPath = node.path) },
        { label: "Delete", danger: true, action: () => confirmDelete(node) },
      ];
    }
    return [
      { label: "Open", action: () => void store.openFile(node.path) },
      { label: "Rename", action: () => (renamingPath = node.path) },
      { label: "Duplicate", action: () => void store.duplicatePath(node.path) },
      { label: "Download", action: () => void store.downloadFile(node.path) },
      { label: "Delete", danger: true, action: () => confirmDelete(node) },
    ];
  }

  // --- Keyboard operations (§8.1) ---
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
    // Prevent the same event from propagating to window right after opening,
    // which would immediately close the ContextMenu (same as in TreeNode).
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
    <span>Files</span>
    <span class="actions">
      <button title="New file" onclick={() => newFile("/")}>+</button>
      <button
        title="Show hidden files"
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
