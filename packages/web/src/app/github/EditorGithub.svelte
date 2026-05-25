<script lang="ts">
  import { store } from "../store.svelte";
  import GithubConnect from "./GithubConnect.svelte";
  import RepoPickerDialog from "./RepoPickerDialog.svelte";
  import Spinner from "../Spinner.svelte";

  const g = $derived(store.github);
  let picking = $state(false);
  let menu = $state(false);
  let busy = $state(false);

  async function withBusy(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  }
  async function onLink(owner: string, repo: string) {
    picking = false;
    await withBusy(() => store.linkRepo(owner, repo));
  }
</script>

{#if !g.login}
  <GithubConnect />
{:else if !g.remote}
  <button
    onclick={() => (picking = true)}
    disabled={busy}
    title="Link this project to a GitHub repo"
  >
    Link repo
  </button>
{:else}
  <div class="repo">
    <button
      class="repo-btn"
      onclick={() => (menu = !menu)}
      title="{g.remote.owner}/{g.remote.repo}@{g.remote.branch}"
    >
      {#if busy}<Spinner />{/if}
      <span class="name">{g.remote.owner}/{g.remote.repo}</span>
    </button>
    {#if menu}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="overlay" onclick={() => (menu = false)}></div>
      <div class="menu">
        <button
          onclick={() => {
            menu = false;
            void withBusy(() => store.pull());
          }}>Pull</button
        >
        <button
          onclick={() => {
            menu = false;
            void withBusy(() => store.push());
          }}>Push</button
        >
        <button
          class="danger"
          onclick={() => {
            menu = false;
            void store.unlinkRepo();
          }}>Unlink</button
        >
      </div>
    {/if}
  </div>
{/if}

{#if picking}
  <RepoPickerDialog title="Link a repository" onpick={onLink} onclose={() => (picking = false)} />
{/if}

<style>
  .repo {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .repo-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 220px;
  }
  /* Clip only the name so the round spinner is never cut into a bar shape. */
  .repo-btn .name {
    min-width: 0; /* allow the name (not the spinner) to shrink + ellipsize */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    z-index: 41;
    display: flex;
    flex-direction: column;
    min-width: 120px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-2);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }
  .menu button {
    text-align: left;
    border: none;
    border-radius: 4px;
    background: transparent;
    padding: 6px 10px;
  }
  .menu button:hover {
    background: var(--bg-3);
  }
  .menu .danger {
    color: var(--error);
  }
</style>
