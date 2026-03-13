import * as turf from '@turf/turf';
import { describe, expect, it, vi } from 'vitest';

import { analyzeSolarPotential, detectRoofPolygon, fetchSolarEstimate } from './solar';

describe('solar', () => {
  it('fetches and parses NASA POWER response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        properties: {
          parameter: {
            ALLSKY_SFC_SW_DWN: {
              '20250101': 4,
              '20250102': 6,
              '20250201': 8,
              '20250202': -999,
            },
          },
        },
      }),
    });

    vi.stubGlobal('fetch', fetchMock);
    const estimate = await fetchSolarEstimate(23.0, 72.0);

    expect(estimate.averageRadiation).toBe(6);
    expect(estimate.monthlyAverages[0].average).toBe(5);
    expect(estimate.monthlyAverages[1].average).toBe(8);

    vi.unstubAllGlobals();
  });

  it('computes panel and cost analysis', () => {
    const analysis = analyzeSolarPotential(
      [
        { lat: 23.0, lon: 72.0 },
        { lat: 23.0, lon: 72.0001 },
        { lat: 23.0001, lon: 72.0001 },
        { lat: 23.0001, lon: 72.0 },
      ],
      {
        latitude: 23.0,
        longitude: 72.0,
        sampledYear: 2025,
        averageRadiation: 5,
        monthlyAverages: Array.from({ length: 12 }).map((_, i) => ({
          month: i + 1,
          label: 'M',
          average: 5,
        })),
      },
      {
        panelAreaM2: 1.7,
        panelPowerW: 400,
        efficiency: 0.2,
        costPerWatt: 2.5,
        electricityPrice: 0.12,
        monthlyConsumptionKwh: 900,
        co2KgPerKwh: 0.4,
      },
    );

    expect(analysis.roofAreaMeters2).toBeGreaterThan(0);
    expect(analysis.panelCount).toBeGreaterThanOrEqual(0);
    expect(analysis.systemSizeKw).toBeGreaterThanOrEqual(0);
    expect(analysis.costSeries20Years.length).toBe(20);
  });

  it('keeps every placed panel fully inside an irregular roof polygon', () => {
    const roof = [
      { lat: 23.0, lon: 72.0 },
      { lat: 23.0, lon: 72.00014 },
      { lat: 23.00005, lon: 72.00014 },
      { lat: 23.00005, lon: 72.00008 },
      { lat: 23.00012, lon: 72.00008 },
      { lat: 23.00012, lon: 72.0 },
    ];

    const analysis = analyzeSolarPotential(
      roof,
      {
        latitude: 23.0,
        longitude: 72.0,
        sampledYear: 2025,
        averageRadiation: 5,
        monthlyAverages: Array.from({ length: 12 }).map((_, i) => ({
          month: i + 1,
          label: 'M',
          average: 5,
        })),
      },
      {
        panelAreaM2: 1.7,
        panelPowerW: 400,
        efficiency: 0.2,
        costPerWatt: 2.5,
        electricityPrice: 0.12,
        monthlyConsumptionKwh: 900,
        co2KgPerKwh: 0.4,
      },
    );

    const roofPolygon = turf.polygon([
      [...roof.map((point) => [point.lon, point.lat] as [number, number]), [roof[0].lon, roof[0].lat]],
    ]);

    for (const panel of analysis.panelPolygons) {
      const panelPolygon = turf.polygon([
        [...panel.map((point) => [point.lon, point.lat] as [number, number]), [panel[0].lon, panel[0].lat]],
      ]);
      expect(turf.booleanWithin(panelPolygon, roofPolygon)).toBe(true);
    }
  });

  it('calls backend roof detection endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'synthetic-ai-model',
        confidence: 0.9,
        polygon: [
          { lat: 23.0, lon: 72.0 },
          { lat: 23.0, lon: 72.1 },
          { lat: 23.1, lon: 72.1 },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await detectRoofPolygon(23, 72, 16, ['a', 'b']);
    expect(result.confidence).toBe(0.9);
    expect(result.polygon.length).toBe(3);

    vi.unstubAllGlobals();
  });
});
