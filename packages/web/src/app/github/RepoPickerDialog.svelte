<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "../store.svelte";
  import Spinner from "../Spinner.svelte";
  import { parseRepoPath, type Repo } from "../../github";

  let {
    title = "Select a repository",
    onpick,
    onclose,
  }: {
    title?: string;
    onpick: (owner: string, repo: string) => void;
    onclose: () => void;
  } = $props();

  let repos = $state<Repo[]>([]);
  let loading = $state(true);
  let err = $state("");
  let filter = $state("");
  let manual = $state("");

  onMount(async () => {
    try {
      repos = await store.listGithubRepos();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  const shown = $derived(
    repos.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase())),
  );

  const manualParsed = $derived(parseRepoPath(manual));

  function pickManual() {
    if (manualParsed) onpick(manualParsed.owner, manualParsed.repo);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    <h2>{title}</h2>
    <input class="manual" placeholder="owner/repo (or pick below)" bind:value={manual} />
    <button class="link" onclick={pickManual} disabled={!manualParsed}> Use owner/repo </button>

    <input class="filter" placeholder="Filter your repositories" bind:value={filter} />
    <div class="list">
      {#if loading}
        <div class="msg"><Spinner /> Loading repositories…</div>
      {:else if err}
        <div class="msg err">{err}</div>
      {:else}
        {#each shown as r (r.full_name)}
          <button class="repo" onclick={() => onpick(r.owner.login, r.name)}>
            <span class="name">{r.full_name}</span>
            {#if r.private}<span class="tag">private</span>{/if}
          </button>
        {/each}
        {#if shown.length === 0}<div class="msg">No repositories.</div>{/if}
      {/if}
    </div>

    <div class="actions"><button onclick={onclose}>Cancel</button></div>
  </div>
</div>

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
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px 22px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-2);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 1.1rem;
  }
  input {
    font: inherit;
    color: var(--fg);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .link {
    align-self: flex-start;
    font-size: 0.82rem;
    padding: 4px 8px;
  }
  .list {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    min-height: 120px;
  }
  .repo {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
  }
  .repo:hover {
    background: var(--bg-3);
  }
  .tag {
    font-size: 0.72rem;
    color: var(--fg-dim);
  }
  .msg {
    padding: 16px;
    color: var(--fg-dim);
    text-align: center;
  }
  .msg.err {
    color: var(--error);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
