<script lang="ts">
  import { onDestroy } from "svelte";
  import { store } from "../store.svelte";

  let jumpBuffer = $state("");
  const svg = $derived(store.renderSvg(store.currentSlide));

  // Show the controls hint while the mouse moves and for 3 seconds after.
  let hintVisible = $state(false);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  function onMouseMove() {
    hintVisible = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hintVisible = false), 3000);
  }
  onDestroy(() => clearTimeout(hintTimer));

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function onKey(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
      case " ":
      case "PageDown":
        store.next();
        break;
      case "ArrowLeft":
      case "PageUp":
        store.prev();
        break;
      case "Escape":
        // Browsers consume the first Escape to exit fullscreen but still fire
        // keydown to JS, so call exit (no-op if already out) and navigate back
        // -- always a one-press exit from present mode.
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        location.hash = "#editor";
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "Enter":
        if (jumpBuffer) {
          store.goSlide(parseInt(jumpBuffer, 10) - 1);
          jumpBuffer = "";
        }
        break;
      default:
        if (/^[0-9]$/.test(e.key)) jumpBuffer += e.key;
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="present" role="presentation" onmousemove={onMouseMove}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html svg}
  {#if jumpBuffer}
    <div class="jump">{jumpBuffer}</div>
  {/if}
  <div class="hint" class:visible={hintVisible}>
    ← → Move / Number+Enter Jump / F Fullscreen / Esc Back
  </div>
</div>

<style>
  .present {
    position: fixed;
    inset: 0;
    background: #000;
  }
  /* Fill the viewport; the SVG's default preserveAspectRatio="xMidYMid meet"
     centers the slide content and letterboxes on the non-matching axis. */
  .present :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .jump {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 6rem;
    color: var(--accent);
    background: rgba(0, 0, 0, 0.6);
    padding: 0 32px;
    border-radius: 12px;
  }
  .hint {
    position: fixed;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.8rem;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  .hint.visible {
    opacity: 1;
  }
</style>
