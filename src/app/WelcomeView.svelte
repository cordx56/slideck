<script lang="ts">
  import { store } from "./store.svelte";
  import { installSample, createEmptyProject } from "./sample";
  import Spinner from "./Spinner.svelte";
  import type { VFS } from "../vfs";

  type PendingKind = "empty" | "sample" | "zip";
  type Step = "menu" | "projects" | "name";

  let step = $state<Step>("menu");
  let pending = $state<{ kind: PendingKind; file?: File } | null>(null);
  let nameValue = $state("");
  let error = $state("");
  // 進行中の処理: "create" / `open:<name>` / null。押されたボタンにのみ spinner。
  let loading = $state<string | null>(null);
  const busy = $derived(loading !== null);
  let zipInput: HTMLInputElement;

  const projects = $derived(store.projects);

  function sampleBase() {
    return `${import.meta.env.BASE_URL}examples/basic/`;
  }
  function toEditor() {
    location.hash = "#editor";
  }

  function startCreate(kind: PendingKind, file?: File) {
    pending = { kind, file };
    nameValue =
      kind === "sample"
        ? "sample"
        : kind === "zip" && file
          ? file.name.replace(/\.zip$/i, "")
          : "untitled";
    error = "";
    step = "name";
  }

  function onZip(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (file) startCreate("zip", file);
  }

  function initializer(p: { kind: PendingKind; file?: File }): (v: VFS) => Promise<void> {
    if (p.kind === "empty") return (v) => createEmptyProject(v);
    if (p.kind === "sample") return (v) => installSample(v, sampleBase());
    const file = p.file!;
    return (v) => v.importZip(file);
  }

  async function submitName() {
    if (!pending || busy) return;
    loading = "create";
    error = "";
    try {
      await store.createProject(nameValue, initializer(pending));
      toEditor();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = null;
    }
  }

  async function open(name: string) {
    if (busy) return;
    loading = `open:${name}`;
    try {
      await store.openProject(name);
      toEditor();
    } finally {
      loading = null;
    }
  }

  async function remove(name: string) {
    if (!confirm(`プロジェクト "${name}" を削除しますか?`)) return;
    await store.deleteProject(name);
    if (store.projects.length === 0) step = "menu";
  }
</script>

<div class="welcome">
  <div class="card">
    <h1>Slider</h1>

    {#if step === "menu"}
      <p>YAML で書くスライドエディタ</p>
      <div class="actions">
        {#if store.ready && store.currentProject}
          <button class="primary" onclick={toEditor}>
            エディタを開く ({store.currentProject})
          </button>
        {/if}
        <button
          class:primary={!store.ready}
          disabled={projects.length === 0}
          onclick={() => (step = "projects")}
        >
          プロジェクトを開く
        </button>
        <button onclick={() => startCreate("empty")}>空のプロジェクトを作成</button>
        <button onclick={() => startCreate("sample")}>サンプルから作成</button>
        <button onclick={() => zipInput.click()}>ZIP からインポート</button>
      </div>
    {:else if step === "projects"}
      <p>プロジェクトを選択</p>
      <ul class="projects">
        {#each projects as p (p.name)}
          <li>
            <button class="open" onclick={() => open(p.name)} disabled={busy}>
              <span class="pname">{p.name}</span>
              {#if loading === `open:${p.name}`}
                <Spinner />
              {:else}
                <span class="pdate">{new Date(p.createdAt).toLocaleDateString()}</span>
              {/if}
            </button>
            <button class="del" title="削除" onclick={() => remove(p.name)}>✕</button>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button onclick={() => (step = "menu")}>戻る</button>
      </div>
    {:else}
      <p>プロジェクト名を入力</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void submitName();
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={nameValue}
          autofocus
          placeholder="my-deck"
          oninput={() => (error = "")}
        />
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => (step = "menu")} disabled={busy}>
            戻る
          </button>
          <button type="submit" class="primary" disabled={busy}>
            {#if loading === "create"}<Spinner />{/if}
            作成
          </button>
        </div>
      </form>
    {/if}

    <input bind:this={zipInput} type="file" accept=".zip" hidden onchange={onZip} />
  </div>
</div>

<style>
  .welcome {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--bg);
  }
  .card {
    width: 360px;
    padding: 32px 40px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-2);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 2rem;
    text-align: center;
  }
  p {
    margin: 0 0 20px;
    color: var(--fg-dim);
    text-align: center;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 16px;
  }
  .primary {
    border-color: var(--accent);
    color: var(--accent);
  }
  .projects {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    max-height: 300px;
    overflow: auto;
  }
  .projects li {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .open {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: left;
    padding: 10px 12px;
  }
  .pdate {
    color: var(--fg-dim);
    font-size: 0.78rem;
  }
  .del {
    color: var(--error);
    padding: 0 10px;
  }
  form input {
    width: 100%;
    font: inherit;
    color: var(--fg);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  form input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .error {
    color: var(--error);
    text-align: left;
    font-size: 0.85rem;
    margin: 0 0 12px;
  }
</style>
