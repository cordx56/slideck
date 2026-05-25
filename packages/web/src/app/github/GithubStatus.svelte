<script lang="ts">
  import { store } from "../store.svelte";
  const g = $derived(store.github);
  const LABEL: Record<string, string> = {
    syncing: "⟳ syncing",
    synced: "✓ synced",
    ahead: "● unpushed",
    conflict: "⚠ conflict",
    error: "⚠ sync error",
    none: "",
  };
  const label = $derived(LABEL[g.status] ?? "");
</script>

{#if g.remote && label}
  <span class="sync {g.status}" title="GitHub: {g.remote.owner}/{g.remote.repo}@{g.remote.branch}">
    {label}
  </span>
{/if}

<style>
  .sync {
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .synced {
    color: #9ece6a;
  }
  .ahead {
    color: var(--accent);
  }
  .syncing {
    color: var(--fg-dim);
  }
  .conflict,
  .error {
    color: var(--error);
  }
</style>
