<script lang="ts">
  import { store } from "./store.svelte";

  let zipInput: HTMLInputElement;

  function sampleBase() {
    return `${import.meta.env.BASE_URL}examples/basic/`;
  }

  async function onZip(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await store.chooseImportZip(file);
  }
</script>

<div class="welcome">
  <div class="card">
    <h1>Slider</h1>
    <p>YAML で書くスライドエディタ</p>
    <div class="actions">
      <button class="primary" onclick={() => store.chooseSample(sampleBase())}>
        サンプルを開く
      </button>
      <button onclick={() => zipInput.click()}>ZIP インポート</button>
      <button onclick={() => store.chooseEmpty()}>空のプロジェクトを作成</button>
    </div>
    <input
      bind:this={zipInput}
      type="file"
      accept=".zip"
      hidden
      onchange={onZip}
    />
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
    text-align: center;
    padding: 40px 56px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-2);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 2rem;
  }
  p {
    margin: 0 0 24px;
    color: var(--fg-dim);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .actions button {
    padding: 10px 16px;
  }
  .primary {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
