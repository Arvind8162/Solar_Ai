import * as turf from '@turf/turf';

export interface LatLng {
  lat: number;
  lon: number;
}

export interface MonthlyRadiation {
  month: number;
  label: string;
  average: number;
}

export interface SolarEstimate {
  latitude: number;
  longitude: number;
  averageRadiation: number;
  sampledYear: number;
  monthlyAverages: MonthlyRadiation[];
}

export interface AnalysisConfig {
  panelAreaM2: number;
  panelPowerW: number;
  efficiency: number;
  costPerWatt: number;
  electricityPrice: number;
  monthlyConsumptionKwh: number;
  co2KgPerKwh: number;
}

export interface SimulatedObstacle {
  id: string;
  kind: 'tree' | 'building';
  heightMeters: number;
  footprint: LatLng[];
  shadowPolygon: LatLng[];
}

export interface SolarPotentialAnalysis {
  latitude: number;
  longitude: number;
  sampledYear: number;
  annualSunshineHours: number;
  averageRadiation: number;
  roofAreaMeters2: number;
  usableRoofAreaMeters2: number;
  shadedAreaMeters2: number;
  shadingLossPct: number;
  roofAzimuthDeg: number;
  optimizedPanelAzimuthDeg: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  panelCount: number;
  maxPanelCount: number;
  systemSizeKw: number;
  estimatedYearlyEnergy: number;
  installationCost: number;
  yearlySavings: number;
  breakEvenYears: number;
  energyCoveragePct: number;
  co2SavingsKg: number;
  monthlyProductionKwh: { label: string; value: number }[];
  costSeries20Years: { year: number; solar: number; noSolar: number }[];
  roofPolygon: LatLng[];
  panelPolygons: LatLng[][];
  shadowPolygons: LatLng[][];
  obstacles: SimulatedObstacle[];
}

interface NasaPowerResponse {
  properties?: {
    parameter?: {
      ALLSKY_SFC_SW_DWN?: Record<string, number | string>;
    };
  };
}

interface LocalFrame {
  origin: LatLng;
  refLat: number;
}

interface XYPoint {
  x: number;
  y: number;
}

interface PanelCandidate {
  polygon: LatLng[];
  score: number;
  shaded: boolean;
}

function toPanelFeature(poly: LatLng[]) {
  const ring = poly.map((point) => [point.lon, point.lat] as [number, number]);
  return turf.polygon([[...ring, ring[0]]]);
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const defaultConfig: AnalysisConfig = {
  panelAreaM2: 1.7,
  panelPowerW: 400,
  efficiency: 0.2,
  costPerWatt: 60,
  electricityPrice: 8,
  monthlyConsumptionKwh: 900,
  co2KgPerKwh: 0.4,
};

function defaultDateRange(): { start: string; end: string; year: number } {
  const year = new Date().getUTCFullYear() - 1;
  return { start: `${year}0101`, end: `${year}1231`, year };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function angularDifference(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

function createFrame(poly: LatLng[]): LocalFrame {
  const center = turf.centroid(toGeoPolygon(poly)).geometry.coordinates;
  return {
    origin: { lat: center[1], lon: center[0] },
    refLat: center[1],
  };
}

function toXY(point: LatLng, frame: LocalFrame): XYPoint {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((frame.refLat * Math.PI) / 180);
  return {
    x: (point.lon - frame.origin.lon) * mPerDegLon,
    y: (point.lat - frame.origin.lat) * mPerDegLat,
  };
}

function toLatLng(point: XYPoint, frame: LocalFrame): LatLng {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((frame.refLat * Math.PI) / 180);
  return {
    lat: frame.origin.lat + point.y / mPerDegLat,
    lon: frame.origin.lon + point.x / mPerDegLon,
  };
}

function rotate(point: XYPoint, angle: number): XYPoint {
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}

function parseRadiationEntries(payload: NasaPowerResponse): Array<[string, number]> {
  const values = payload.properties?.parameter?.ALLSKY_SFC_SW_DWN;
  if (!values) {
    return [];
  }

  return Object.entries(values)
    .map(([k, v]) => [k, Number(v)] as [string, number])
    .filter(([_, v]) => Number.isFinite(v) && v > -900);
}

function calculateMonthlyAverages(entries: Array<[string, number]>): MonthlyRadiation[] {
  const totals = Array(12).fill(0);
  const counts = Array(12).fill(0);

  for (const [date, value] of entries) {
    const month = Number(date.slice(4, 6));
    if (month >= 1 && month <= 12) {
      totals[month - 1] += value;
      counts[month - 1] += 1;
    }
  }

  return MONTH_LABELS.map((label, idx) => ({
    month: idx + 1,
    label,
    average: counts[idx] > 0 ? totals[idx] / counts[idx] : 0,
  }));
}

function normalizePolygon(poly: LatLng[]): LatLng[] {
  const cleaned = poly.filter(
    (point, index) =>
      index === 0 || Math.abs(point.lat - poly[index - 1].lat) > 1e-9 || Math.abs(point.lon - poly[index - 1].lon) > 1e-9,
  );

  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lon - last.lon) < 1e-9) {
      cleaned.pop();
    }
  }

  return cleaned;
}

function toGeoPolygon(poly: LatLng[]) {
  const ring = normalizePolygon(poly).map((p) => [p.lon, p.lat] as [number, number]);
  const closed = ring.length > 0 ? [...ring, ring[0]] : ring;
  return turf.polygon([closed]);
}

function simplifyRoofPolygon(poly: LatLng[]): LatLng[] {
  if (poly.length < 3) {
    return poly;
  }

  const simplified = turf.simplify(toGeoPolygon(poly), {
    tolerance: 0.0000035,
    highQuality: true,
    mutate: false,
  });

  const ring = simplified.geometry.coordinates[0] ?? [];
  const points = ring.slice(0, -1).map(([lon, lat]) => ({ lat, lon }));
  return points.length >= 3 ? points : normalizePolygon(poly);
}

function polygonAreaM2(poly: LatLng[]): number {
  return turf.area(toGeoPolygon(poly));
}

function bboxMeters(poly: LatLng[], frame: LocalFrame) {
  const local = poly.map((point) => toXY(point, frame));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of local) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY, local };
}

function edgeAngle(polyXY: XYPoint[]): number {
  let best = { length: 0, angle: 0 };
  for (let index = 0; index < polyXY.length; index++) {
    const start = polyXY[index];
    const end = polyXY[(index + 1) % polyXY.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length > best.length) {
      best = { length, angle: Math.atan2(dy, dx) };
    }
  }
  return best.angle;
}

function inferRoofAzimuth(poly: LatLng[]): { edgeAngleRad: number; roofAzimuthDeg: number; optimizedAzimuthDeg: number } {
  const frame = createFrame(poly);
  const local = poly.map((point) => toXY(point, frame));
  const edgeAngleRad = edgeAngle(local);
  const longestEdgeIndex = local.reduce(
    (best, point, index) => {
      const next = local[(index + 1) % local.length];
      const length = Math.hypot(next.x - point.x, next.y - point.y);
      return length > best.length ? { index, length } : best;
    },
    { index: 0, length: 0 },
  ).index;
  const start = poly[longestEdgeIndex];
  const end = poly[(longestEdgeIndex + 1) % poly.length];
  const baseAzimuth = ((turf.bearing([start.lon, start.lat], [end.lon, end.lat]) % 360) + 360) % 360;
  const oppositeAzimuth = (baseAzimuth + 180) % 360;
  const solarSouth = frame.origin.lat >= 0 ? 180 : 0;

  const optimizedAzimuthDeg =
    angularDifference(baseAzimuth, solarSouth) <= angularDifference(oppositeAzimuth, solarSouth)
      ? baseAzimuth
      : oppositeAzimuth;

  return {
    edgeAngleRad,
    roofAzimuthDeg: baseAzimuth,
    optimizedAzimuthDeg,
  };
}

function averageSunPosition(latitude: number): { azimuthDeg: number; elevationDeg: number } {
  const dayOfYear = 172;
  const declinationDeg = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180);
  const elevationDeg = clamp(90 - Math.abs(latitude - declinationDeg), 18, 82);
  return {
    azimuthDeg: latitude >= 0 ? 180 : 0,
    elevationDeg,
  };
}

function seededValue(seed: number, offset: number): number {
  return Math.abs(Math.sin(seed * 12.9898 + offset * 78.233));
}

function rectanglePolygon(center: XYPoint, width: number, height: number, angle: number, frame: LocalFrame): LatLng[] {
  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => rotate(point, angle));

  return corners.map((point) => toLatLng({ x: center.x + point.x, y: center.y + point.y }, frame));
}

function translatePolygon(poly: LatLng[], dxMeters: number, dyMeters: number): LatLng[] {
  const frame = createFrame(poly);
  return poly.map((point) => {
    const local = toXY(point, frame);
    return toLatLng({ x: local.x + dxMeters, y: local.y + dyMeters }, frame);
  });
}

function makeShadowPolygon(footprint: LatLng[], azimuthDeg: number, elevationDeg: number, heightMeters: number): LatLng[] {
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const lengthMeters = clamp(heightMeters / Math.tan((elevationDeg * Math.PI) / 180), 3, 35);
  const dx = -Math.sin(azimuthRad) * lengthMeters;
  const dy = -Math.cos(azimuthRad) * lengthMeters;
  const translated = translatePolygon(footprint, dx, dy);
  return [...footprint, ...translated.reverse()];
}

function simulateObstacles(poly: LatLng[]): SimulatedObstacle[] {
  const frame = createFrame(poly);
  const { minX, minY, maxX, maxY } = bboxMeters(poly, frame);
  const width = maxX - minX;
  const height = maxY - minY;
  const seed = Math.abs(Math.sin(frame.origin.lat * 17.123 + frame.origin.lon * 9.87));
  const { azimuthDeg, elevationDeg } = averageSunPosition(frame.origin.lat);

  const templates = [
    {
      id: 'tree-west',
      kind: 'tree' as const,
      center: { x: minX - width * 0.2, y: maxY + height * 0.12 },
      width: clamp(3 + seededValue(seed, 1) * 2.2, 2.5, 5.5),
      height: clamp(3 + seededValue(seed, 2) * 2.5, 2.5, 5.8),
      angle: 0.2,
      obstacleHeight: clamp(7 + seededValue(seed, 3) * 8, 6, 15),
    },
    {
      id: 'building-east',
      kind: 'building' as const,
      center: { x: maxX + width * 0.18, y: minY + height * 0.2 },
      width: clamp(5 + seededValue(seed, 4) * 3.5, 4.5, 8.5),
      height: clamp(7 + seededValue(seed, 5) * 4.5, 6.5, 11.5),
      angle: 0.1,
      obstacleHeight: clamp(10 + seededValue(seed, 6) * 12, 9, 22),
    },
    {
      id: 'tree-south',
      kind: 'tree' as const,
      center: { x: width * 0.1, y: minY - height * 0.28 },
      width: clamp(2.5 + seededValue(seed, 7) * 2, 2.5, 4.8),
      height: clamp(2.5 + seededValue(seed, 8) * 2, 2.5, 4.8),
      angle: 0.35,
      obstacleHeight: clamp(5 + seededValue(seed, 9) * 7, 4, 12),
    },
  ];

  return templates.map((template) => {
    const footprint = rectanglePolygon(template.center, template.width, template.height, template.angle, frame);
    return {
      id: template.id,
      kind: template.kind,
      heightMeters: template.obstacleHeight,
      footprint,
      shadowPolygon: makeShadowPolygon(footprint, azimuthDeg, elevationDeg, template.obstacleHeight),
    };
  });
}

function panelCandidates(
  poly: LatLng[],
  panelAreaM2: number,
  edgeAngleRad: number,
  obstacles: SimulatedObstacle[],
): PanelCandidate[] {
  if (poly.length < 3) {
    return [];
  }

  const frame = createFrame(poly);
  const roofPolygon = toGeoPolygon(poly);
  const shadowPolygons = obstacles.map((obstacle) => toGeoPolygon(obstacle.shadowPolygon));
  const roofBbox = turf.bbox(roofPolygon);
  const bboxCorners = [
    { lat: roofBbox[1], lon: roofBbox[0] },
    { lat: roofBbox[1], lon: roofBbox[2] },
    { lat: roofBbox[3], lon: roofBbox[2] },
    { lat: roofBbox[3], lon: roofBbox[0] },
  ];
  const rotated = bboxCorners.map((point) => rotate(toXY(point, frame), -edgeAngleRad));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of rotated) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const panelWidth = 1.1;
  const panelHeight = Math.max(panelAreaM2 / panelWidth, 1.4);
  const gap = 0.22;
  const centroid = turf.centroid(roofPolygon).geometry.coordinates;
  const centerPoint = { lat: centroid[1], lon: centroid[0] };

  const candidates: PanelCandidate[] = [];

  for (let y = minY + panelHeight / 2; y <= maxY - panelHeight / 2; y += panelHeight + gap) {
    for (let x = minX + panelWidth / 2; x <= maxX - panelWidth / 2; x += panelWidth + gap) {
      const corners = [
        { x: x - panelWidth / 2, y: y - panelHeight / 2 },
        { x: x + panelWidth / 2, y: y - panelHeight / 2 },
        { x: x + panelWidth / 2, y: y + panelHeight / 2 },
        { x: x - panelWidth / 2, y: y + panelHeight / 2 },
      ].map((point) => rotate(point, edgeAngleRad))
        .map((point) => toLatLng(point, frame));
      const panelPoly = toPanelFeature(corners);

      const centerRotated = rotate({ x, y }, edgeAngleRad);
      const centerLatLng = toLatLng(centerRotated, frame);
      if (!turf.booleanWithin(panelPoly, roofPolygon)) {
        continue;
      }

      const shaded = shadowPolygons.some((shadow) => turf.booleanIntersects(panelPoly, shadow));
      const distancePenalty = Math.hypot(centerLatLng.lat - centerPoint.lat, centerLatLng.lon - centerPoint.lon);
      candidates.push({
        polygon: corners,
        shaded,
        score: shaded ? -1000 - distancePenalty : 100 - distancePenalty,
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function buildHeatPoints(poly: LatLng[], radiation: number, shadows: LatLng[][]): Array<[number, number, number]> {
  const frame = createFrame(poly);
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(toGeoPolygon(poly));
  const roof = toGeoPolygon(poly);
  const shadowAreas = shadows.map((shadow) => toGeoPolygon(shadow));
  const rows = 5;
  const cols = 5;
  const points: Array<[number, number, number]> = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lat = minLat + ((row + 0.5) / rows) * (maxLat - minLat || 0.00008);
      const lon = minLon + ((col + 0.5) / cols) * (maxLon - minLon || 0.00008);
      const candidate = turf.point([lon, lat]);
      if (!turf.booleanPointInPolygon(candidate, roof)) {
        continue;
      }

      const local = toXY({ lat, lon }, frame);
      const roofOrientation = inferRoofAzimuth(poly).optimizedAzimuthDeg;
      const roofScore = 1 - angularDifference(roofOrientation, averageSunPosition(frame.origin.lat).azimuthDeg) / 180;
      const shaded = shadowAreas.some((shadow) => turf.booleanPointInPolygon(candidate, shadow));
      const wobble = 0.92 + 0.08 * Math.sin(local.x * 0.08 + local.y * 0.05);
      const intensity = clamp((radiation / 8) * wobble * (shaded ? 0.28 : 0.95 + roofScore * 0.08), 0.12, 1);
      points.push([lat, lon, intensity]);
    }
  }

  return points;
}

export async function fetchSolarEstimate(lat: number, lon: number): Promise<SolarEstimate> {
  const { start, end, year } = defaultDateRange();
  const params = new URLSearchParams({
    parameters: 'ALLSKY_SFC_SW_DWN',
    community: 'RE',
    longitude: lon.toString(),
    latitude: lat.toString(),
    start,
    end,
    format: 'JSON',
  });

  const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${params}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { messages?: string[] };
    throw new Error(body.messages?.[0] ?? `NASA POWER request failed (${response.status})`);
  }

  const payload = (await response.json()) as NasaPowerResponse;
  const entries = parseRadiationEntries(payload);
  if (entries.length === 0) {
    throw new Error('NASA POWER returned no usable solar radiation values.');
  }

  const averageRadiation = entries.reduce((total, [_, value]) => total + value, 0) / entries.length;

  return {
    latitude: lat,
    longitude: lon,
    sampledYear: year,
    averageRadiation,
    monthlyAverages: calculateMonthlyAverages(entries),
  };
}

export async function detectRoofPolygon(
  latitude: number,
  longitude: number,
  zoom: number,
  tileUrls: string[],
): Promise<{ polygon: LatLng[]; confidence: number; source: string }> {
  const response = await fetch('/api/roof-detect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude, longitude, zoom, tileUrls }),
  });

  if (!response.ok) {
    throw new Error('Roof detection request failed.');
  }

  const data = (await response.json()) as {
    polygon: Array<{ lat: number; lon: number }>;
    confidence: number;
    source: string;
  };

  const polygon = simplifyRoofPolygon(data.polygon);
  return {
    polygon,
    confidence: data.confidence,
    source: `${data.source} + turf-simplify`,
  };
}

export function analyzeSolarPotential(
  roofPolygonRaw: LatLng[],
  estimate: SolarEstimate,
  cfg: AnalysisConfig,
  requestedPanelCount?: number,
): SolarPotentialAnalysis {
  const roofPolygon = simplifyRoofPolygon(roofPolygonRaw);
  const roofAreaMeters2 = polygonAreaM2(roofPolygon);
  const { edgeAngleRad, roofAzimuthDeg, optimizedAzimuthDeg } = inferRoofAzimuth(roofPolygon);
  const sun = averageSunPosition(estimate.latitude);
  const obstacles = simulateObstacles(roofPolygon);
  const candidates = panelCandidates(roofPolygon, cfg.panelAreaM2, edgeAngleRad, obstacles);
  const availableCandidates = candidates.filter((candidate) => !candidate.shaded);
  const maxPanelCount = availableCandidates.length;
  const panelCount = clamp(Math.round(requestedPanelCount ?? maxPanelCount), 0, maxPanelCount);
  const panelPolygons = availableCandidates.slice(0, panelCount).map((candidate) => candidate.polygon);

  const usableRoofAreaMeters2 = Math.min(roofAreaMeters2, availableCandidates.length * cfg.panelAreaM2);
  const shadedAreaMeters2 = Math.max(0, roofAreaMeters2 - usableRoofAreaMeters2);
  const shadingLossPct = roofAreaMeters2 > 0 ? (shadedAreaMeters2 / roofAreaMeters2) * 100 : 0;

  const effectivePanelArea = panelCount * cfg.panelAreaM2;
  const orientationGain = 1 - angularDifference(optimizedAzimuthDeg, sun.azimuthDeg) / 720;
  const shadingFactor = 1 - shadingLossPct / 100;
  const energyMultiplier = clamp(orientationGain * (0.82 + shadingFactor * 0.18), 0.45, 1.02);
  const estimatedYearlyEnergy = estimate.averageRadiation * effectivePanelArea * cfg.efficiency * 365 * energyMultiplier;

  const systemSizeKw = (panelCount * cfg.panelPowerW) / 1000;
  const installationCost = systemSizeKw * 1000 * cfg.costPerWatt;
  const annualConsumption = cfg.monthlyConsumptionKwh * 12;
  const yearlySavings = Math.min(estimatedYearlyEnergy, annualConsumption) * cfg.electricityPrice;
  const breakEvenYears = yearlySavings > 0 ? installationCost / yearlySavings : 0;
  const energyCoveragePct = annualConsumption > 0 ? (estimatedYearlyEnergy / annualConsumption) * 100 : 0;
  const co2SavingsKg = estimatedYearlyEnergy * cfg.co2KgPerKwh;
  const annualSunshineHours = estimate.averageRadiation * 365;
  const maintenanceCostPerYear = installationCost * 0.01;

  const monthlyProductionKwh = estimate.monthlyAverages.map((month, index) => ({
    label: month.label,
    value: month.average * effectivePanelArea * cfg.efficiency * DAYS_IN_MONTH[index] * energyMultiplier,
  }));

  const costSeries20Years: { year: number; solar: number; noSolar: number }[] = [];
  for (let year = 1; year <= 20; year++) {
    const yearlyGridCostWithSolar = Math.max(annualConsumption - estimatedYearlyEnergy, 0) * cfg.electricityPrice;
    const solar = installationCost + year * (maintenanceCostPerYear + yearlyGridCostWithSolar);
    const noSolar = year * annualConsumption * cfg.electricityPrice;
    costSeries20Years.push({ year, solar, noSolar });
  }

  return {
    latitude: estimate.latitude,
    longitude: estimate.longitude,
    sampledYear: estimate.sampledYear,
    annualSunshineHours,
    averageRadiation: estimate.averageRadiation,
    roofAreaMeters2,
    usableRoofAreaMeters2,
    shadedAreaMeters2,
    shadingLossPct,
    roofAzimuthDeg,
    optimizedPanelAzimuthDeg: optimizedAzimuthDeg,
    sunAzimuthDeg: sun.azimuthDeg,
    sunElevationDeg: sun.elevationDeg,
    panelCount,
    maxPanelCount,
    systemSizeKw,
    estimatedYearlyEnergy,
    installationCost,
    yearlySavings,
    breakEvenYears,
    energyCoveragePct,
    co2SavingsKg,
    monthlyProductionKwh,
    costSeries20Years,
    roofPolygon,
    panelPolygons,
    shadowPolygons: obstacles.map((obstacle) => obstacle.shadowPolygon),
    obstacles,
  };
}

export function heatPointsForRoof(
  analysis: Pick<SolarPotentialAnalysis, 'roofPolygon' | 'shadowPolygons' | 'optimizedPanelAzimuthDeg'>,
  monthlyRadiation: number,
) {
  return buildHeatPoints(analysis.roofPolygon, monthlyRadiation, analysis.shadowPolygons);
}

export function popupSummary(analysis: SolarPotentialAnalysis): string {
  return [
    '<b>Building Insights</b>',
    `Roof area: ${analysis.roofAreaMeters2.toFixed(1)} m2`,
    `Usable area: ${analysis.usableRoofAreaMeters2.toFixed(1)} m2`,
    `Panels: ${analysis.panelCount}/${analysis.maxPanelCount}`,
    `Shade loss: ${analysis.shadingLossPct.toFixed(1)}%`,
    `Optimized azimuth: ${analysis.optimizedPanelAzimuthDeg.toFixed(0)} deg`,
    `Estimated yearly energy: ${analysis.estimatedYearlyEnergy.toFixed(0)} kWh`,
  ].join('<br/>');
}
