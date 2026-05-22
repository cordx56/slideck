<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import EditorView from "./editor/EditorView.svelte";
  import PresentView from "./present/PresentView.svelte";
  import WelcomeView from "./WelcomeView.svelte";

  // ハッシュベースの簡易ルーティング ("#present" でプレゼンモード)。
  let route = $state(currentRoute());

  function currentRoute(): string {
    return location.hash.replace(/^#\/?/, "");
  }

  onMount(() => {
    void store.boot();
    const onHash = () => (route = currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });
</script>

{#if store.screen === "loading"}
  <div class="boot">読み込み中...</div>
{:else if store.screen === "welcome"}
  <WelcomeView />
{:else if route === "present"}
  <PresentView />
{:else}
  <EditorView />
{/if}

<style>
  .boot {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: var(--fg-dim);
  }
</style>
