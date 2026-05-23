<script lang="ts">
  interface Props {
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }
  let { message, confirmLabel = "OK", danger = false, onConfirm, onCancel }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter") onConfirm();
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="overlay" role="button" tabindex="-1" onclick={onCancel} onkeydown={() => {}}>
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
  >
    <p>{message}</p>
    <div class="buttons">
      <button onclick={onCancel}>Cancel</button>
      <button class:danger onclick={onConfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .dialog {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 24px;
    max-width: 420px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  }
  p {
    margin: 0 0 18px;
    white-space: pre-line;
    line-height: 1.5;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .danger {
    border-color: var(--error);
    color: var(--error);
  }
</style>
