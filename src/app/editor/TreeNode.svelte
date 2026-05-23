<script lang="ts">
  import { getContext } from "svelte";
  import Self from "./TreeNode.svelte";
  import { store } from "../store.svelte";
  import { TREE_CTX, type TreeNode, type TreeCtx } from "./tree";
  import { isImagePath, isFontPath } from "../../lib/mime";
  import { extname } from "../../vfs/path";

  interface Props {
    node: TreeNode;
    depth: number;
  }
  let { node, depth }: Props = $props();
  const ctx = getContext<TreeCtx>(TREE_CTX);

  let dragOver = $state(false);
  let rowEl = $state<HTMLDivElement | null>(null);

  const isFolder = $derived(node.kind === "folder");
  const open = $derived(store.isExpanded(node.path));
  const active = $derived(store.openPath === node.path);
  const selected = $derived(ctx.selected() === node.path);
  const broken = $derived(store.filesWithBrokenRefs.has(node.path));
  const dirty = $derived(active && store.dirty);

  // キーボードで選択が移ったら表示領域内へスクロールする。
  $effect(() => {
    if (selected) rowEl?.scrollIntoView({ block: "nearest" });
  });

  function icon(): string {
    if (isFolder) return open ? "folderOpen" : "folder";
    if (isImagePath(node.path)) return "image";
    if (isFontPath(node.path)) return "font";
    const e = extname(node.path);
    return e === ".yaml" || e === ".yml" ? "code" : "file";
  }

  function onRowClick() {
    ctx.select(node);
    if (isFolder) store.toggleExpanded(node.path);
  }

  function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData("application/x-vfs-path", node.path);
    // ツリー内移動(move)とエディタへのパス挿入(copy)の両方を許可。
    e.dataTransfer!.effectAllowed = "copyMove";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragOver = false;
    if (!isFolder) return; // ファイルへのドロップは無効
    const from = e.dataTransfer?.getData("application/x-vfs-path");
    if (from) ctx.dropMove(from, node.path);
    else if (e.dataTransfer?.items.length) ctx.dropUpload(e.dataTransfer.items, node.path);
  }

  function submitRename(e: { currentTarget: HTMLInputElement }) {
    ctx.submitRename(node.path, e.currentTarget.value.trim());
  }
</script>

<!-- キーボード操作は FileTree コンテナ側で集約処理する -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={rowEl}
  class="row"
  class:active
  class:selected
  class:dragOver
  style="padding-left:{depth * 14 + 6}px"
  role="treeitem"
  aria-selected={selected}
  tabindex="-1"
  draggable="true"
  ondragstart={onDragStart}
  ondragover={(e) => {
    if (isFolder) {
      e.preventDefault();
      dragOver = true;
    }
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
  onclick={onRowClick}
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.select(node);
    ctx.openMenu(node, e.clientX, e.clientY);
  }}
  ondblclick={() => ctx.startRename(node.path)}
>
  <span class="chev">{#if isFolder}{open ? "▾" : "▸"}{/if}</span>
  <span class="icon icon-{icon()}"></span>

  {#if ctx.renaming() === node.path}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="rename"
      value={node.name}
      autofocus
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Enter") submitRename(e);
        else if (e.key === "Escape") ctx.cancelRename();
      }}
      onblur={submitRename}
    />
  {:else}
    <span class="name">{node.name}</span>
    {#if dirty}<span class="dot dirty" title="未保存"></span>{/if}
    {#if broken}<span class="dot broken" title="壊れた参照"></span>{/if}
  {/if}
</div>

{#if isFolder && open}
  {#each node.children as child (child.path)}
    <Self node={child} depth={depth + 1} />
  {/each}
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding-right: 8px;
    cursor: pointer;
    font-size: 0.84rem;
    white-space: nowrap;
    user-select: none;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  /* キーボード/クリックでの選択カーソル (open ファイルとは別表示) */
  .row.selected {
    background: rgba(230, 69, 83, 0.08);
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .row.active {
    background: rgba(230, 69, 83, 0.16);
    color: var(--accent);
  }
  .row.dragOver {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .chev {
    width: 12px;
    color: var(--fg-dim);
    font-size: 0.7rem;
  }
  .icon {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    background: currentColor;
    opacity: 0.7;
    -webkit-mask: var(--svg) center / contain no-repeat;
    mask: var(--svg) center / contain no-repeat;
  }
  /* lucide 風の単純アイコンを mask で描画 */
  .icon-folder {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>');
  }
  .icon-folderOpen {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>');
  }
  .icon-file {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/></svg>');
  }
  .icon-code {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="m9 13-2 2 2 2"/><path d="m13 17 2-2-2-2"/></svg>');
  }
  .icon-image {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>');
  }
  .icon-font {
    --svg: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>');
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .dot.dirty {
    background: var(--fg);
  }
  .dot.broken {
    background: var(--error);
  }
  .rename {
    flex: 1;
    font: inherit;
    font-size: 0.84rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
  }
</style>
