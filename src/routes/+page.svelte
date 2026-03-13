<script lang="ts">
  import { onMount } from 'svelte';

  import Sidebar from '../components/Sidebar.svelte';
  import type { MapController } from '$lib/map';
  import { createSolarMap } from '$lib/map';
  import {
    analyzeSolarPotential,
    defaultConfig,
    detectRoofPolygon,
    fetchSolarEstimate,
    heatPointsForRoof,
    popupSummary,
    type AnalysisConfig,
    type LatLng,
    type SolarEstimate,
    type SolarPotentialAnalysis,
  } from '$lib/solar';

  interface HistoryItem {
    timestamp: string;
    analysis: SolarPotentialAnalysis;
  }

  let mapElement: HTMLDivElement;
  let searchQuery = '';
  let searchMessage = '';

  let loading = false;
  let requestError = '';
  let latestAnalysis: SolarPotentialAnalysis | undefined;
  let history: HistoryItem[] = [];

  let showHeatmap = true;
  let showRoof = true;
  let showPanels = true;
  let selectedMonth = 1;
  let selectedPanelCount = 0;

  let monthlyConsumptionKwh = defaultConfig.monthlyConsumptionKwh;
  let costPerWatt = defaultConfig.costPerWatt;
  let electricityPrice = defaultConfig.electricityPrice;

  let mapController: MapController | undefined;

  let detectedRoof: LatLng[] | undefined;
  let detectedEstimate: SolarEstimate | undefined;

  function analysisConfig(): AnalysisConfig {
    return {
      ...defaultConfig,
      monthlyConsumptionKwh,
      costPerWatt,
      electricityPrice,
    };
  }

  function recomputeFromDetected() {
    if (!detectedRoof || !detectedEstimate) {
      return;
    }

    latestAnalysis = analyzeSolarPotential(
      detectedRoof,
      detectedEstimate,
      analysisConfig(),
      selectedPanelCount || undefined,
    );
    mapController?.renderPanelPolygons(latestAnalysis.panelPolygons);
    mapController?.renderShading(latestAnalysis.obstacles);

    const monthIndex = Math.max(0, Math.min(11, selectedMonth - 1));
    const monthRadiation = detectedEstimate.monthlyAverages[monthIndex]?.average ?? detectedEstimate.averageRadiation;
    mapController?.setHeatmap(heatPointsForRoof(latestAnalysis, monthRadiation));
    mapController?.setVisibility({ showHeatmap, showRoof, showPanels });
  }

  function exportHistoryCsv() {
    if (history.length === 0) {
      return;
    }

    const header = [
      'timestamp',
      'latitude',
      'longitude',
      'sampled_year',
      'annual_sunshine_hours',
      'roof_area_m2',
      'max_panel_count',
      'panel_count',
      'system_size_kw',
      'yearly_energy_kwh',
      'installation_cost_inr',
      'yearly_savings_inr',
      'co2_savings_kg',
      'break_even_years',
    ];

    const rows = history.map(({ timestamp, analysis }) => [
      timestamp,
      analysis.latitude.toFixed(6),
      analysis.longitude.toFixed(6),
      analysis.sampledYear.toString(),
      analysis.annualSunshineHours.toFixed(2),
      analysis.roofAreaMeters2.toFixed(2),
      analysis.maxPanelCount.toString(),
      analysis.panelCount.toString(),
      analysis.systemSizeKw.toFixed(3),
      analysis.estimatedYearlyEnergy.toFixed(2),
      analysis.installationCost.toFixed(2),
      analysis.yearlySavings.toFixed(2),
      analysis.co2SavingsKg.toFixed(2),
      analysis.breakEvenYears.toFixed(2),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `solar-estimates-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function searchLocation(query: string) {
    const q = query.trim();
    if (!q || !mapController) {
      return;
    }

    searchMessage = 'Searching...';
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      );
      const data = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        searchMessage = 'Location not found.';
        return;
      }

      const lat = Number(data[0].lat);
      const lon = Number(data[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        searchMessage = 'Invalid location result.';
        return;
      }

      mapController.setView(lat, lon, 18);
      searchMessage = '';
    } catch {
      searchMessage = 'Unable to search location right now.';
    }
  }

  async function runAnalysis(latitude: number, longitude: number, zoom: number, tileUrls: string[]) {
    loading = true;
    requestError = '';

    try {
      const roof = await detectRoofPolygon(latitude, longitude, zoom, tileUrls);
      const estimate = await fetchSolarEstimate(latitude, longitude);

      detectedRoof = roof.polygon;
      detectedEstimate = estimate;
      selectedPanelCount = 0;

      recomputeFromDetected();

      if (latestAnalysis) {
        selectedPanelCount = latestAnalysis.panelCount;
        history = [{ timestamp: new Date().toISOString(), analysis: latestAnalysis }, ...history].slice(
          0,
          50,
        );
        mapController?.renderRoofPolygon(latestAnalysis.roofPolygon, popupSummary(latestAnalysis));
      }

      return [
        '<b>AI Roof Detection Complete</b>',
        `Model source: ${roof.source} (${(roof.confidence * 100).toFixed(0)}% confidence)`,
        `Roof area: ${latestAnalysis?.roofAreaMeters2.toFixed(1) ?? '--'} m²`,
        `Estimated yearly energy: ${latestAnalysis?.estimatedYearlyEnergy.toFixed(0) ?? '--'} kWh`,
      ].join('<br/>');
    } catch (error) {
      requestError = error instanceof Error ? error.message : 'Unable to analyze rooftop.';
      return `<b>Solar analysis failed</b><br/>${requestError}`;
    } finally {
      loading = false;
    }
  }

  $: if (mapController) {
    mapController.setVisibility({ showHeatmap, showRoof, showPanels });
  }

  $: {
    // Recompute metrics and panel layout when financial settings change.
    monthlyConsumptionKwh;
    costPerWatt;
    electricityPrice;
    recomputeFromDetected();
  }

  $: {
    // Refresh monthly heatmap when month changes.
    selectedMonth;
    if (detectedRoof && detectedEstimate && latestAnalysis && mapController) {
      const monthIndex = Math.max(0, Math.min(11, selectedMonth - 1));
      const monthRadiation =
        detectedEstimate.monthlyAverages[monthIndex]?.average ?? detectedEstimate.averageRadiation;
      mapController.setHeatmap(heatPointsForRoof(latestAnalysis, monthRadiation));
    }
  }

  $: {
    selectedPanelCount;
    if (detectedRoof && detectedEstimate) {
      recomputeFromDetected();
    }
  }

  onMount(() => {
    const setup = async () => {
      mapController = await createSolarMap(mapElement, async (payload) =>
        runAnalysis(payload.latitude, payload.longitude, payload.zoom, payload.tileUrls),
      );
      mapController.setVisibility({ showHeatmap, showRoof, showPanels });
    };

    void setup();

    return () => {
      mapController?.destroy();
    };
  });
</script>

<div class="flex flex-row h-full">
  <div class="w-full relative">
    <div bind:this={mapElement} class="w-full h-full" />

    <form
      class="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] w-[min(640px,90%)]"
      on:submit|preventDefault={() => searchLocation(searchQuery)}
    >
      <div class="search-shell rounded-2xl px-3 py-2 flex items-center gap-2">
        <input
          class="search-input w-full outline-none bg-transparent"
          type="text"
          placeholder="Search location (city, address, landmark)"
          bind:value={searchQuery}
        />
        <button type="submit" class="search-go-btn">Go</button>
      </div>
      {#if searchMessage}
        <div class="search-message mt-2 text-center text-xs rounded-lg px-3 py-1.5">{searchMessage}</div>
      {/if}
    </form>
  </div>

  <Sidebar
    {loading}
    error={requestError}
    analysis={latestAnalysis}
    bind:showHeatmap
    bind:showRoof
    bind:showPanels
    bind:selectedMonth
    bind:selectedPanelCount
    bind:monthlyConsumptionKwh
    bind:costPerWatt
    bind:electricityPrice
    historyCount={history.length}
    onExport={exportHistoryCsv}
  />
</div>

<style>
  .search-shell {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
    backdrop-filter: blur(8px);
  }

  .search-input {
    font-size: 0.95rem;
    color: #0f172a;
    padding-left: 0.35rem;
  }

  .search-input::placeholder {
    color: #64748b;
  }

  .search-go-btn {
    border: none;
    border-radius: 9999px;
    padding: 0.5rem 1.1rem;
    font-weight: 600;
    font-size: 0.9rem;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    color: #fff;
    cursor: pointer;
    transition: transform 120ms ease, filter 120ms ease;
  }

  .search-go-btn:hover {
    filter: brightness(1.05);
  }

  .search-go-btn:active {
    transform: translateY(1px);
  }

  .search-message {
    background: rgba(15, 23, 42, 0.86);
    color: #f8fafc;
  }
</style>
