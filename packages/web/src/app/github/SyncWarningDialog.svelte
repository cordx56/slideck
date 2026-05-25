<script lang="ts">
  import { store } from "../store.svelte";
  const warning = $derived(store.github.warning);
</script>

{#if warning}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => store.dismissSyncWarning()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dialog" onclick={(e) => e.stopPropagation()}>
      <h2>⚠ {warning.title}</h2>
      <ul>
        {#each warning.files as f (f)}
          <li>{f}</li>
        {/each}
      </ul>
      <div class="actions">
        <button class="primary" onclick={() => store.dismissSyncWarning()}>OK</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .dialog {
    width: 460px;
    max-width: 92vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-2);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 1.05rem;
    color: var(--error);
  }
  ul {
    margin: 0 0 16px;
    padding-left: 18px;
    overflow: auto;
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
    color: var(--fg-dim);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .primary {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
