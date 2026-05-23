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

  // #editor / #present はプロジェクトのロードが前提。未ロードならトップへ戻す。
  $effect(() => {
    if (!store.booting && (route === "editor" || route === "present") && !store.ready) {
      location.hash = "";
    }
  });
</script>

{#if store.booting}
  <div class="boot">読み込み中...</div>
{:else if route === "editor" && store.ready}
  <EditorView />
{:else if route === "present" && store.ready}
  <PresentView />
{:else}
  <WelcomeView />
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
