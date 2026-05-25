<script lang="ts">
  import { store } from "../store.svelte";
  import Spinner from "../Spinner.svelte";

  // block: full-width trigger (welcome menu); compact otherwise (editor toolbar).
  let { block = false }: { block?: boolean } = $props();

  let open = $state(false);
  let token = $state("");
  let error = $state("");
  let busy = $state(false);

  const login = $derived(store.github.login);

  async function connect() {
    if (busy || !token.trim()) return;
    busy = true;
    error = "";
    try {
      await store.connectGithub(token);
      open = false;
      token = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if login}
  <div class="connected">
    <span class="who">GitHub: <strong>{login}</strong></span>
    <button class="ghbtn" onclick={() => store.disconnectGithub()}>Disconnect</button>
  </div>
{:else}
  <button class="ghbtn connect" class:block onclick={() => (open = true)}>Connect GitHub</button>
{/if}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (open = false)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dialog" onclick={(e) => e.stopPropagation()}>
      <h2>Connect GitHub</h2>
      <p>
        Paste a fine-grained Personal Access Token with <strong>Contents: Read and write</strong> on the
        repositories you want to sync.
      </p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="password"
          autofocus
          bind:value={token}
          placeholder="github_pat_…"
          oninput={() => (error = "")}
        />
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="submit" class="primary" disabled={busy || !token.trim()}>
            {#if busy}<Spinner />{/if} Connect
          </button>
          <button type="button" onclick={() => (open = false)}>Cancel</button>
        </div>
      </form>
      <a
        class="hint"
        href="https://github.com/settings/personal-access-tokens"
        target="_blank"
        rel="noopener">Create a token →</a
      >
    </div>
  </div>
{/if}

<style>
  .ghbtn {
    padding: 8px 14px;
  }
  .connect {
    border-color: var(--accent);
    color: var(--accent);
  }
  .connect.block {
    width: 100%;
    padding: 10px 16px;
  }
  .connected {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }
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
    width: 420px;
    max-width: 92vw;
    padding: 22px 24px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-2);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.15rem;
  }
  p {
    margin: 0 0 14px;
    color: var(--fg-dim);
    font-size: 0.88rem;
    text-align: left;
  }
  input {
    width: 100%;
    font: inherit;
    color: var(--fg);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 9px 11px;
    margin-bottom: 12px;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .primary {
    border-color: var(--accent);
    color: var(--accent);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .error {
    color: var(--error);
    font-size: 0.82rem;
    margin: 0 0 10px;
  }
  .hint {
    display: inline-block;
    margin-top: 12px;
    font-size: 0.8rem;
    color: var(--accent);
  }
</style>
