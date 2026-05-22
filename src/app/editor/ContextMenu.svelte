<script lang="ts">
  export interface MenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
  }
  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
  }
  let { x, y, items, onClose }: Props = $props();
</script>

<svelte:window
  on:click={onClose}
  on:contextmenu={onClose}
  on:keydown={(e) => e.key === "Escape" && onClose()}
/>

<div class="menu" style="left:{x}px; top:{y}px" role="menu" tabindex="-1">
  {#each items as item (item.label)}
    <button
      class:danger={item.danger}
      role="menuitem"
      onclick={(e) => {
        e.stopPropagation();
        onClose();
        item.action();
      }}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 200;
    min-width: 180px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 0.85rem;
  }
  button:hover {
    background: rgba(230, 69, 83, 0.15);
  }
  .danger {
    color: var(--error);
  }
</style>
