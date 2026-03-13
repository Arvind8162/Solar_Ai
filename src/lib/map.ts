import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';

import type { LatLng, SimulatedObstacle } from './solar';

export interface MapClickPayload {
  latitude: number;
  longitude: number;
  zoom: number;
  tileUrls: string[];
}

export interface MapRenderOptions {
  showRoof: boolean;
  showPanels: boolean;
  showHeatmap: boolean;
}

export interface MapController {
  destroy: () => void;
  renderRoofPolygon: (polygon: LatLng[], popupHtml?: string) => void;
  renderPanelPolygons: (panels: LatLng[][]) => void;
  renderShading: (obstacles: SimulatedObstacle[]) => void;
  setHeatmap: (points: Array<[number, number, number]>) => void;
  setVisibility: (opts: MapRenderOptions) => void;
  setView: (latitude: number, longitude: number, zoom?: number) => void;
}

const DEFAULT_CENTER: [number, number] = [23.0225, 72.5714];
const DEFAULT_ZOOM = 13;

function tileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function collectTileUrls(lat: number, lon: number, zoom: number, satelliteTemplate: string): string[] {
  const z = Math.max(0, Math.round(zoom));
  const { x, y } = tileXY(lat, lon, z);
  const urls: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      urls.push(
        satelliteTemplate
          .replace('{z}', z.toString())
          .replace('{x}', (x + dx).toString())
          .replace('{y}', (y + dy).toString()),
      );
    }
  }
  return urls;
}

function toLeafletLatLngs(L: typeof Leaflet, points: LatLng[]): Leaflet.LatLngExpression[] {
  return points.map((p) => L.latLng(p.lat, p.lon));
}

export async function createSolarMap(
  container: HTMLElement,
  onMapClick: (payload: MapClickPayload) => Promise<string>,
): Promise<MapController> {
  const L = await import('leaflet');
  if (typeof window !== 'undefined') {
    (window as unknown as { L?: typeof Leaflet }).L = L;
  }
  await import('leaflet.heat');

  const map = L.map(container).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 20,
  });

  const maptilerKey = import.meta.env.VITE_MAPTILER_KEY;
  const satelliteTemplate = maptilerKey
    ? `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${maptilerKey}`
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  const satellite = L.tileLayer(satelliteTemplate, {
    attribution: maptilerKey
      ? '&copy; MapTiler &copy; OpenStreetMap contributors'
      : 'Tiles &copy; Esri',
    maxZoom: 20,
  });

  satellite.addTo(map);

  L.control.layers({ Street: street, Satellite: satellite }).addTo(map);

  let roofLayer: Leaflet.Polygon | undefined;
  const panelLayer = L.layerGroup().addTo(map);
  const shadingLayer = L.layerGroup().addTo(map);
  let heatLayer: Leaflet.Layer | undefined;
  const heatAvailable =
    typeof (L as unknown as { heatLayer?: unknown }).heatLayer === 'function';

  const visibility: MapRenderOptions = {
    showRoof: true,
    showPanels: true,
    showHeatmap: true,
  };

  map.on('click', async (event: Leaflet.LeafletMouseEvent) => {
    const latitude = event.latlng.lat;
    const longitude = event.latlng.lng;
    const zoom = map.getZoom();

    const popup = L.popup()
      .setLatLng([latitude, longitude])
      .setContent('<b>Detecting roof...</b><br/>Running AI segmentation')
      .openOn(map);

    try {
      const html = await onMapClick({
        latitude,
        longitude,
        zoom,
        tileUrls: collectTileUrls(latitude, longitude, zoom, satelliteTemplate),
      });
      popup.setContent(html);
    } catch {
      popup.setContent('Automatic roof detection failed. Please click another building.');
    }
  });

  const syncVisibility = () => {
    if (roofLayer) {
      roofLayer.setStyle({ opacity: visibility.showRoof ? 1 : 0, fillOpacity: visibility.showRoof ? 0.25 : 0 });
    }

    panelLayer.eachLayer((layer) => {
      if ('setStyle' in layer) {
        (layer as Leaflet.Polygon).setStyle({
          opacity: visibility.showPanels ? 1 : 0,
          fillOpacity: visibility.showPanels ? 0.55 : 0,
        });
      }
    });

    shadingLayer.eachLayer((layer) => {
      if ('setStyle' in layer) {
        (layer as Leaflet.Path).setStyle({
          opacity: visibility.showRoof ? 1 : 0,
          fillOpacity: visibility.showRoof ? 0.18 : 0,
        });
      }
    });

    if (heatLayer) {
      if (visibility.showHeatmap) {
        heatLayer.addTo(map);
      } else {
        heatLayer.remove();
      }
    }
  };

  return {
    destroy: () => map.remove(),
    renderRoofPolygon: (polygon, popupHtml) => {
      roofLayer?.remove();
      roofLayer = L.polygon(toLeafletLatLngs(L, polygon), {
        color: '#4f46e5',
        fillColor: '#6366f1',
        fillOpacity: 0.25,
        weight: 3,
      }).addTo(map);
      if (popupHtml) {
        roofLayer.bindPopup(popupHtml).openPopup();
      }
      map.fitBounds(roofLayer.getBounds(), { padding: [20, 20] });
      syncVisibility();
    },
    renderPanelPolygons: (panels) => {
      panelLayer.clearLayers();
      for (const panel of panels) {
        L.polygon(toLeafletLatLngs(L, panel), {
          color: '#f59e0b',
          fillColor: '#fbbf24',
          fillOpacity: 0.55,
          weight: 1,
        }).addTo(panelLayer);
      }
      syncVisibility();
    },
    renderShading: (obstacles) => {
      shadingLayer.clearLayers();
      for (const obstacle of obstacles) {
        L.polygon(toLeafletLatLngs(L, obstacle.shadowPolygon), {
          color: '#111827',
          fillColor: '#111827',
          fillOpacity: 0.18,
          weight: 1,
          dashArray: '4 4',
        })
          .bindTooltip(`${obstacle.kind} shadow`, { direction: 'top' })
          .addTo(shadingLayer);

        L.polygon(toLeafletLatLngs(L, obstacle.footprint), {
          color: obstacle.kind === 'tree' ? '#15803d' : '#334155',
          fillColor: obstacle.kind === 'tree' ? '#16a34a' : '#475569',
          fillOpacity: 0.45,
          weight: 1.5,
        })
          .bindTooltip(`${obstacle.kind} - ${obstacle.heightMeters.toFixed(1)} m`, { direction: 'top' })
          .addTo(shadingLayer);
      }
      syncVisibility();
    },
    setHeatmap: (points) => {
      if (!heatAvailable || typeof window === 'undefined') {
        return;
      }
      heatLayer?.remove();
      heatLayer = (
        L as unknown as { heatLayer: (p: Array<[number, number, number]>, opts?: object) => Leaflet.Layer }
      ).heatLayer(points, {
        radius: 25,
        blur: 20,
        maxZoom: 19,
      });
      if (visibility.showHeatmap) {
        heatLayer.addTo(map);
      }
    },
    setVisibility: (opts) => {
      visibility.showRoof = opts.showRoof;
      visibility.showPanels = opts.showPanels;
      visibility.showHeatmap = opts.showHeatmap;
      syncVisibility();
    },
    setView: (latitude: number, longitude: number, zoom: number = 18) => {
      map.flyTo([latitude, longitude], zoom, { duration: 1.2 });
    },
  };
}
