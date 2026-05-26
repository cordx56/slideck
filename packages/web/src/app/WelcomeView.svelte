<script lang="ts">
  import { store } from "./store.svelte";
  import { createEmptyProject } from "./sample";
  import Spinner from "./Spinner.svelte";
  import GithubConnect from "./github/GithubConnect.svelte";
  import RepoPickerDialog from "./github/RepoPickerDialog.svelte";
  import type { VFS } from "../vfs";

  // The sample is a built-in template; a project template carries its name.
  type TemplateRef = { sample: boolean; name?: string };
  type PendingKind = "empty" | "zip" | "clone" | "template";
  type Step = "menu" | "projects" | "templates" | "makeTemplate" | "name";

  let step = $state<Step>("menu");
  let pending = $state<{
    kind: PendingKind;
    file?: File;
    owner?: string;
    repo?: string;
    template?: TemplateRef;
  } | null>(null);
  let cloning = $state(false);
  let nameValue = $state("");
  let error = $state("");
  // In-progress action: "create" / `open:<name>` / null. Spinner only on the pressed button.
  let loading = $state<string | null>(null);
  const busy = $derived(loading !== null);
  let zipInput: HTMLInputElement;

  const projects = $derived(store.projects);
  // Projects that are not yet templates (candidates for "make a template").
  const eligible = $derived(projects.filter((p) => !p.isTemplate));

  function toEditor() {
    location.hash = "#editor";
  }

  // A project name not already in use (base, base-1, base-2, ...).
  function freshName(base: string): string {
    if (!store.projectExists(base)) return base;
    for (let i = 1; ; i++) {
      if (!store.projectExists(`${base}-${i}`)) return `${base}-${i}`;
    }
  }

  function startCreate(kind: "empty" | "zip", file?: File) {
    pending = { kind, file };
    nameValue = kind === "zip" && file ? file.name.replace(/\.zip$/i, "") : "untitled";
    error = "";
    step = "name";
  }

  function startTemplate(template: TemplateRef, base: string) {
    pending = { kind: "template", template };
    nameValue = freshName(base);
    error = "";
    step = "name";
  }

  function makeTemplate(name: string) {
    store.markTemplate(name);
    step = "templates";
  }

  function onZip(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (file) startCreate("zip", file);
  }

  function startClone(owner: string, repo: string) {
    cloning = false;
    pending = { kind: "clone", owner, repo };
    nameValue = repo;
    error = "";
    step = "name";
  }

  function initializer(p: { kind: PendingKind; file?: File }): (v: VFS) => Promise<void> {
    if (p.kind === "empty") return (v) => createEmptyProject(v);
    const file = p.file!;
    return (v) => v.importZip(file);
  }

  async function submitName() {
    if (!pending || busy) return;
    loading = "create";
    error = "";
    try {
      if (pending.kind === "clone") {
        await store.cloneProject(nameValue, pending.owner!, pending.repo!);
      } else if (pending.kind === "template") {
        await store.createFromTemplate(nameValue, pending.template!);
      } else {
        await store.createProject(nameValue, initializer(pending));
      }
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
    if (!confirm(`Delete project "${name}"?`)) return;
    await store.deleteProject(name);
    if (store.projects.length === 0) step = "menu";
  }
</script>

<div class="welcome">
  <div class="card">
    <h1>slideck</h1>

    {#if step === "menu"}
      <p>A slide editor you write in YAML</p>
      <div class="actions">
        {#if store.ready && store.currentProject}
          <button class="primary" onclick={toEditor}>
            Open editor ({store.currentProject})
          </button>
        {/if}
        <button
          class:primary={!store.ready}
          disabled={projects.length === 0}
          onclick={() => (step = "projects")}
        >
          Open project
        </button>
        <button onclick={() => startCreate("empty")}>Create empty project</button>
        <button onclick={() => (step = "templates")}>Create from template</button>
        <button onclick={() => zipInput.click()}>Import from ZIP</button>
        {#if store.github.login}
          <button onclick={() => (cloning = true)}>Clone repository</button>
        {/if}
      </div>
      <div class="github">
        <GithubConnect block />
      </div>
    {:else if step === "projects"}
      <p>Select a project</p>
      <ul class="projects">
        {#each projects as p (p.name)}
          <li>
            <button class="open" onclick={() => open(p.name)} disabled={busy}>
              <span class="pname">{p.name}</span>
              {#if loading === `open:${p.name}`}
                <Spinner />
              {:else}
                <span class="pdate"
                  >{p.isTemplate ? "template" : new Date(p.createdAt).toLocaleDateString()}</span
                >
              {/if}
            </button>
            <button class="del" title="Delete" onclick={() => remove(p.name)}>✕</button>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button onclick={() => (step = "menu")}>Back</button>
      </div>
    {:else if step === "templates"}
      <p>Select a template</p>
      <ul class="projects">
        <li>
          <button class="open" onclick={() => startTemplate({ sample: true }, "sample")}>
            <span class="pname">Sample</span>
            <span class="pdate">built-in</span>
          </button>
        </li>
        {#each store.templates as t (t.name)}
          <li>
            <button
              class="open"
              onclick={() => startTemplate({ sample: false, name: t.name }, t.name)}
            >
              <span class="pname">{t.name}</span>
              <span class="pdate">template</span>
            </button>
            <button
              class="untag"
              title="Remove from templates (keeps the project)"
              onclick={() => store.unmarkTemplate(t.name)}>✕</button
            >
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button onclick={() => (step = "makeTemplate")} disabled={eligible.length === 0}>
          Use an existing project as a template
        </button>
        <button onclick={() => (step = "menu")}>Back</button>
      </div>
    {:else if step === "makeTemplate"}
      <p>Pick a project to use as a template</p>
      <ul class="projects">
        {#each eligible as p (p.name)}
          <li>
            <button class="open" onclick={() => makeTemplate(p.name)}>
              <span class="pname">{p.name}</span>
              <span class="pdate">{new Date(p.createdAt).toLocaleDateString()}</span>
            </button>
          </li>
        {/each}
        {#if eligible.length === 0}
          <li><span class="empty">No projects available.</span></li>
        {/if}
      </ul>
      <div class="actions">
        <button onclick={() => (step = "templates")}>Back</button>
      </div>
    {:else}
      <p>Enter a project name</p>
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
          <button type="submit" class="primary" disabled={busy}>
            {#if loading === "create"}<Spinner />{/if}
            Create
          </button>
          <button type="button" onclick={() => (step = "menu")} disabled={busy}> Back </button>
        </div>
      </form>
    {/if}

    <input bind:this={zipInput} type="file" accept=".zip" hidden onchange={onZip} />
  </div>

  {#if cloning}
    <RepoPickerDialog
      title="Clone a repository"
      onpick={startClone}
      onclose={() => (cloning = false)}
    />
  {/if}

  <a class="repo-link" href="https://github.com/cordx56/slideck" target="_blank" rel="noopener">
    GitHub Repo
  </a>
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
    font-weight: 200;
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
  .github {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
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
  /* Remove-from-templates: muted, not destructive (the project itself stays). */
  .untag {
    color: var(--fg-dim);
    padding: 0 10px;
  }
  .empty {
    display: block;
    padding: 12px;
    color: var(--fg-dim);
    text-align: center;
    font-size: 0.85rem;
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
  /* Pinned to the very bottom of the viewport, outside the card frame. */
  .repo-link {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    color: var(--fg-dim);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .repo-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
