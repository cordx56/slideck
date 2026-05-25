<script lang="ts">
  interface Props {
    size?: number;
  }
  let { size = 14 }: Props = $props();
</script>

<span class="spinner" style="--sp-size:{size}px" aria-label="Loading"></span>

<style>
  .spinner {
    display: inline-block;
    flex: none; /* never let a flex parent squash the circle into an oval */
    box-sizing: border-box;
    width: var(--sp-size, 14px);
    height: var(--sp-size, 14px);
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    vertical-align: -2px;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
