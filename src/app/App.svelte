<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import { FetchAssetResolver } from "../load/assets";
  import EditorView from "./editor/EditorView.svelte";
  import PresentView from "./present/PresentView.svelte";

  // ハッシュベースの簡易ルーティング ("#present" でプレゼンモード)。
  let route = $state(currentRoute());

  function currentRoute(): string {
    return location.hash.replace(/^#\/?/, "");
  }

  onMount(() => {
    const base = `${import.meta.env.BASE_URL}examples/basic/`;
    void store.init(new FetchAssetResolver(base));
    const onHash = () => (route = currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });
</script>

{#if !store.ready}
  <div class="boot">読み込み中...</div>
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
