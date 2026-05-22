<script lang="ts">
  import { store } from "../store.svelte";
  import type { Path } from "../../edit/ast";

  const ref = $derived(store.selectedRef);

  function set(path: Path, value: string) {
    store.updateField(path, value);
  }
</script>

{#if ref}
  <div class="inspector">
    <div class="head">
      <span class="type">{ref.type}</span>
      <button class="del" onclick={() => store.deleteSelected()}>削除</button>
    </div>

    <!-- 位置 (全要素共通、line を除く) -->
    {#if ref.type !== "line"}
      <div class="grid">
        {@render field("left", ["position", "left"])}
        {@render field("top", ["position", "top"])}
        {@render field("width", ["position", "width"])}
        {@render field("height", ["position", "height"])}
      </div>
    {/if}

    {#if ref.type === "text"}
      {@render area("text", ["text"])}
      <div class="grid">
        {@render field("size", ["size"])}
        {@render field("color", ["color"])}
        {@render field("font", ["font"])}
        {@render select("align", ["align"], ["", "left", "center", "right"])}
      </div>
    {:else if ref.type === "image"}
      {@render field("src", ["src"])}
      {@render select("fit", ["fit"], ["", "contain", "cover", "fill"])}
    {:else if ref.type === "rect"}
      <div class="grid">
        {@render field("fill", ["fill"])}
        {@render field("stroke", ["stroke"])}
        {@render field("strokeWidth", ["strokeWidth"])}
        {@render field("rx", ["rx"])}
      </div>
    {:else if ref.type === "group"}
      <div class="grid">
        {@render select("layout", ["layout"], ["", "row", "column"])}
        {@render field("gap", ["gap"])}
        {@render select("align", ["align"], [
          "",
          "start",
          "center",
          "end",
          "stretch",
        ])}
        {@render select("justify", ["justify"], [
          "",
          "start",
          "center",
          "end",
          "space-between",
          "space-around",
        ])}
      </div>
    {/if}
  </div>
{/if}

{#snippet field(label: string, path: Path)}
  <label>
    <span>{label}</span>
    <input
      value={store.getFieldValue(path)}
      onchange={(e) => set(path, e.currentTarget.value)}
    />
  </label>
{/snippet}

{#snippet area(label: string, path: Path)}
  <label class="wide">
    <span>{label}</span>
    <textarea
      rows="2"
      value={store.getFieldValue(path)}
      onchange={(e) => set(path, e.currentTarget.value)}
    ></textarea>
  </label>
{/snippet}

{#snippet select(label: string, path: Path, options: string[])}
  <label>
    <span>{label}</span>
    <select
      value={store.getFieldValue(path)}
      onchange={(e) => set(path, e.currentTarget.value)}
    >
      {#each options as opt (opt)}
        <option value={opt}>{opt || "(既定)"}</option>
      {/each}
    </select>
  </label>
{/snippet}

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .type {
    color: var(--accent);
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
  }
  .del {
    font-size: 0.75rem;
    padding: 3px 8px;
    color: var(--error);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.72rem;
    color: var(--fg-dim);
  }
  label.wide {
    grid-column: 1 / -1;
  }
  input,
  select,
  textarea {
    font: inherit;
    font-size: 0.78rem;
    color: var(--fg);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
    width: 100%;
  }
  textarea {
    resize: vertical;
    font-family: ui-monospace, monospace;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
