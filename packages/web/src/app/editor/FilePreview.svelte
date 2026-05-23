<script lang="ts">
  import { store } from "../store.svelte";
  import { isImagePath, isFontPath } from "@slideck/core";
  import { basename } from "@slideck/core";
  import { isTtc, extractFontFromTtc } from "@slideck/core";

  interface Props {
    path: string;
  }
  let { path }: Props = $props();

  const kind = $derived(
    isImagePath(path) ? "image" : isFontPath(path) ? "font" : "binary",
  );

  let imageUrl = $state<string | null>(null);
  let fontFamily = $state<string | null>(null);
  let info = $state("");

  // Prepare preview resources whenever path changes.
  $effect(() => {
    const p = path;
    imageUrl = null;
    fontFamily = null;
    info = "";
    const vfs = store.vfs;
    if (!vfs) return;

    if (isImagePath(p)) {
      void vfs.getObjectURL(p).then((u) => {
        if (path === p) imageUrl = u;
      });
    } else if (isFontPath(p)) {
      const family = `preview-${basename(p)}`;
      void vfs.readBytes(p).then(async (bytes) => {
        try {
          // Browsers' FontFace can't handle .ttc, so extract the first font.
          const data = isTtc(bytes) ? extractFontFromTtc(bytes, 0) : bytes;
          const face = new FontFace(family, data as BufferSource);
          await face.load();
          document.fonts.add(face);
          if (path === p) fontFamily = family;
        } catch {
          if (path === p) info = "Could not load font";
        }
      });
    } else {
      void vfs.stat(p).then((s) => {
        if (path === p) info = `Binary file, not editable (${s?.size ?? 0} bytes)`;
      });
    }
  });
</script>

<div class="preview">
  <div class="name">{path}</div>

  {#if kind === "image"}
    {#if imageUrl}
      <img src={imageUrl} alt={path} />
    {/if}
  {:else if kind === "font"}
    {#if fontFamily}
      <div class="samples" style="font-family:'{fontFamily}'">
        <p style="font-size:32px">The quick brown fox jumps over the lazy dog</p>
        <p style="font-size:32px">Pack my box with five dozen liquor jugs 0123456789</p>
        <p style="font-size:20px">{basename(path)}</p>
      </div>
    {:else}
      <p class="info">{info || "Loading..."}</p>
    {/if}
  {:else}
    <p class="info">{info}</p>
  {/if}
</div>

<style>
  .preview {
    height: 100%;
    overflow: auto;
    padding: 24px;
    background: var(--bg-2);
  }
  .name {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--fg-dim);
    margin-bottom: 16px;
  }
  img {
    max-width: 100%;
    background: repeating-conic-gradient(#2a2a33 0% 25%, #20212e 0% 50%) 50% / 24px 24px;
    border: 1px solid var(--border);
  }
  .samples p {
    margin: 0 0 14px;
    line-height: 1.4;
  }
  .info {
    color: var(--fg-dim);
  }
</style>
