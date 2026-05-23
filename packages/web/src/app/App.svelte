<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import EditorView from "./editor/EditorView.svelte";
  import PresentView from "./present/PresentView.svelte";
  import WelcomeView from "./WelcomeView.svelte";

  // Simple hash-based routing ("#present" enters presentation mode).
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

  // #editor / #present require a loaded project. Return to top if not loaded.
  // Server-linked mode can always open the editor (there is no top screen).
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
  <div class="boot">Loading...</div>
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
