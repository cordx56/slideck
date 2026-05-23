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
  // サーバ連携モードは常にエディタが開ける (トップ画面は無い)。
  $effect(() => {
    if (
      !store.booting &&
      !store.serverMode &&
      (route === "editor" || route === "present") &&
      !store.ready
    ) {
      location.hash = "";
    }
  });
</script>

{#if store.booting}
  <div class="boot">読み込み中...</div>
{:else if route === "present" && store.ready}
  <PresentView />
{:else if store.ready && (route === "editor" || store.serverMode)}
  <EditorView />
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
