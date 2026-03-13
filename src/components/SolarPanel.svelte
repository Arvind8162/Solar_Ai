<script lang="ts">
  export let panelCount = 0;
  $: shown = Math.min(panelCount, 120);
</script>

<div class="space-y-2">
  <p class="text-sm primary-text"><b>Panel Placement Preview</b></p>
  {#if panelCount === 0}
    <p class="text-xs outline-text">No panels placed yet.</p>
  {:else}
    <div class="grid grid-cols-12 gap-1 p-2 border rounded bg-slate-50 max-h-28 overflow-auto">
      {#each Array(shown) as _, i}
        <div class="h-2 rounded-sm bg-amber-500" title={`Panel ${i + 1}`} />
      {/each}
    </div>
    <p class="text-xs outline-text">{panelCount} panels total</p>
  {/if}
</div>
