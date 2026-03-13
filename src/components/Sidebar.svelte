<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    BarController,
    BarElement,
  } from 'chart.js';

  import SolarPanel from './SolarPanel.svelte';
  import type { SolarPotentialAnalysis } from '$lib/solar';

  Chart.register(
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    BarController,
    BarElement,
  );

  export let loading = false;
  export let error = '';
  export let analysis: SolarPotentialAnalysis | undefined;

  export let showHeatmap = true;
  export let showRoof = true;
  export let showPanels = true;
  export let selectedMonth = 1;
  export let selectedPanelCount = 0;

  export let monthlyConsumptionKwh = 900;
  export let costPerWatt = 60;
  export let electricityPrice = 8;

  export let historyCount = 0;
  export let onExport: () => void = () => {};

  let costChartCanvas: HTMLCanvasElement;
  let monthlyChartCanvas: HTMLCanvasElement;
  let costChart: Chart | undefined;
  let monthlyChart: Chart | undefined;

  function formatINR(value: number) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(value);
  }

  $: if (analysis && costChartCanvas) {
    const labels = analysis.costSeries20Years.map((x) => `${x.year}`);
    const solar = analysis.costSeries20Years.map((x) => Number(x.solar.toFixed(2)));
    const noSolar = analysis.costSeries20Years.map((x) => Number(x.noSolar.toFixed(2)));

    if (!costChart) {
      costChart = new Chart(costChartCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Solar', data: solar, borderColor: '#22c55e', backgroundColor: '#22c55e33' },
            { label: 'No Solar', data: noSolar, borderColor: '#ef4444', backgroundColor: '#ef444433' },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${formatINR(Number(ctx.parsed.y))}`,
              },
            },
          },
          scales: {
            y: {
              ticks: {
                callback: (v) => formatINR(Number(v)),
              },
            },
          },
        },
      });
    } else {
      costChart.data.labels = labels;
      costChart.data.datasets[0].data = solar;
      costChart.data.datasets[1].data = noSolar;
      costChart.update();
    }
  }

  $: if (analysis && monthlyChartCanvas) {
    const labels = analysis.monthlyProductionKwh.map((x) => x.label);
    const vals = analysis.monthlyProductionKwh.map((x) => Number(x.value.toFixed(1)));

    if (!monthlyChart) {
      monthlyChart = new Chart(monthlyChartCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Monthly kWh',
              data: vals,
              backgroundColor: '#f59e0b',
              borderColor: '#b45309',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
        },
      });
    } else {
      monthlyChart.data.labels = labels;
      monthlyChart.data.datasets[0].data = vals;
      monthlyChart.update();
    }
  }

  onDestroy(() => {
    costChart?.destroy();
    monthlyChart?.destroy();
  });
</script>

<aside class="flex-none md:w-[29rem] w-[25rem] p-2 pt-3 overflow-auto">
  <div class="flex flex-col space-y-3 h-full">
    <div class="p-4 surface-variant rounded-lg">
      <p class="primary-text"><b>Solar Potential Demo</b></p>
      <p class="text-sm outline-text">
        Search a location, click a rooftop in satellite view, then tune the installed panel count like the Google Solar flow.
      </p>
    </div>

    {#if loading}
      <div class="p-4 rounded-lg surface-variant flex items-center gap-2">
        <md-circular-progress indeterminate />
        <span>AI roof segmentation and solar analysis in progress...</span>
      </div>
    {/if}

    {#if error}
      <div class="p-4 rounded-lg error-container on-error-container-text">{error}</div>
    {/if}

    <details class="p-4 rounded-lg surface shadow-md" open>
      <summary class="primary-text cursor-pointer"><b>Building Insights</b></summary>
      {#if analysis}
        <div class="pt-3 space-y-1 text-sm">
          <p><b>Annual sunshine:</b> {analysis.annualSunshineHours.toFixed(1)} hr</p>
          <p><b>Roof area:</b> {analysis.roofAreaMeters2.toFixed(1)} m²</p>
          <p><b>Usable roof area:</b> {analysis.usableRoofAreaMeters2.toFixed(1)} m²</p>
          <p><b>Max panel count:</b> {analysis.maxPanelCount}</p>
          <p><b>Shade loss:</b> {analysis.shadingLossPct.toFixed(1)}%</p>
          <p><b>CO₂ savings:</b> {analysis.co2SavingsKg.toFixed(1)} kg/year</p>
          <p><b>Roof azimuth:</b> {analysis.roofAzimuthDeg.toFixed(0)}°</p>
        </div>
      {:else}
        <p class="pt-3 text-sm outline-text">No building selected yet.</p>
      {/if}
    </details>

    <details class="p-4 rounded-lg surface shadow-md" open>
      <summary class="primary-text cursor-pointer"><b>Data Layers</b></summary>
      <div class="pt-3 space-y-3 text-sm">
        <label class="flex items-center justify-between">
          <span>Monthly sunshine heatmap</span>
          <input type="checkbox" bind:checked={showHeatmap} />
        </label>
        <label class="flex items-center justify-between">
          <span>Roof overlay</span>
          <input type="checkbox" bind:checked={showRoof} />
        </label>
        <label class="flex items-center justify-between">
          <span>Solar panels</span>
          <input type="checkbox" bind:checked={showPanels} />
        </label>
        <div>
          <label class="block" for="month-slider">Month ({selectedMonth})</label>
          <input
            id="month-slider"
            class="w-full"
            type="range"
            min="1"
            max="12"
            step="1"
            bind:value={selectedMonth}
          />
        </div>
        {#if analysis}
          <p class="text-xs outline-text">
            Simulated sun: {analysis.sunAzimuthDeg.toFixed(0)}° azimuth, {analysis.sunElevationDeg.toFixed(0)}° elevation
          </p>
        {/if}
      </div>
    </details>

    <details class="p-4 rounded-lg surface shadow-md" open>
      <summary class="primary-text cursor-pointer"><b>Solar Potential Analysis</b></summary>

      <div class="pt-3 space-y-3 text-sm">
        <div class="grid grid-cols-2 gap-2">
          <label>
            Monthly usage (kWh)
            <input class="w-full border rounded p-1" type="number" min="1" bind:value={monthlyConsumptionKwh} />
          </label>
          <label>
            Cost/Watt (₹)
            <input class="w-full border rounded p-1" type="number" min="0.1" step="0.1" bind:value={costPerWatt} />
          </label>
          <label class="col-span-2">
            Electricity price (₹/kWh)
            <input class="w-full border rounded p-1" type="number" min="0.01" step="0.01" bind:value={electricityPrice} />
          </label>
        </div>

        {#if analysis}
          <p><b>Yearly energy:</b> {analysis.estimatedYearlyEnergy.toFixed(1)} kWh</p>
          <p><b>Installation size:</b> {analysis.systemSizeKw.toFixed(2)} kW</p>
          <p><b>Installation cost:</b> {formatINR(analysis.installationCost)}</p>
          <p><b>Energy covered:</b> {analysis.energyCoveragePct.toFixed(1)}%</p>
          <p><b>Yearly savings:</b> {formatINR(analysis.yearlySavings)}</p>
          <p><b>Break-even:</b> {analysis.breakEvenYears.toFixed(1)} years</p>
          <p><b>Optimized panel azimuth:</b> {analysis.optimizedPanelAzimuthDeg.toFixed(0)}°</p>

          <div class="space-y-2 rounded-lg border border-slate-200 p-3">
            <div class="flex items-center justify-between">
              <p><b>Panel Placement Preview</b></p>
              <span class="text-xs outline-text">{analysis.panelCount} / {analysis.maxPanelCount} panels</span>
            </div>
            <label class="block" for="panel-slider">Panels ({selectedPanelCount || analysis.panelCount})</label>
            <input
              id="panel-slider"
              class="w-full"
              type="range"
              min="1"
              max={Math.max(1, analysis.maxPanelCount)}
              step="1"
              bind:value={selectedPanelCount}
            />
            <p class="text-xs outline-text">Move the slider to reduce or restore automatic full-roof coverage.</p>
            <SolarPanel panelCount={analysis.panelCount} />
          </div>

          <div class="space-y-2">
            <p><b>20-Year Cost Comparison</b></p>
            <div class="h-48"><canvas bind:this={costChartCanvas} /></div>
          </div>

          <div class="space-y-2">
            <p><b>Monthly Production</b></p>
            <div class="h-48"><canvas bind:this={monthlyChartCanvas} /></div>
          </div>
        {:else}
          <p class="outline-text">Click a building roof to generate analysis.</p>
        {/if}
      </div>
    </details>

    <div class="p-4 rounded-lg surface-variant space-y-2">
      <div class="flex items-center justify-between">
        <p class="label-large primary-text"><b>History</b></p>
        <md-filled-tonal-button role={undefined} disabled={historyCount === 0} on:click={onExport}
          >Export CSV</md-filled-tonal-button
        >
      </div>
      <p class="text-xs outline-text">Saved analyses: {historyCount} (max 50)</p>
    </div>

    <div class="grow" />
  </div>
</aside>
