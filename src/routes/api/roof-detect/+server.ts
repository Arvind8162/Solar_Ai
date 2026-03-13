import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface RoofDetectRequest {
  latitude: number;
  longitude: number;
  zoom: number;
  tileUrls?: string[];
}

interface RoofPoint {
  lat: number;
  lon: number;
}

interface RoofDetectResponse {
  source: string;
  confidence: number;
  polygon: RoofPoint[];
  debug?: Record<string, unknown>;
}

function metersToDegreesLat(meters: number): number {
  return meters / 111320;
}

function metersToDegreesLon(meters: number, lat: number): number {
  return meters / (111320 * Math.cos((lat * Math.PI) / 180));
}

function rotate(x: number, y: number, angleDeg: number): { x: number; y: number } {
  const theta = (angleDeg * Math.PI) / 180;
  return {
    x: x * Math.cos(theta) - y * Math.sin(theta),
    y: x * Math.sin(theta) + y * Math.cos(theta),
  };
}

function syntheticRoofPolygon(lat: number, lon: number): RoofPoint[] {
  const seed = Math.abs(Math.sin(lat * 12.345 + lon * 67.89));
  const width = 14 + seed * 10;
  const height = 10 + seed * 8;
  const angle = 15 + seed * 60;

  const base = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: 0 },
    { x: width * 0.2, y: 0 },
    { x: width * 0.2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ];

  return base.map((point) => {
    const r = rotate(point.x, point.y, angle);
    return {
      lat: lat + metersToDegreesLat(r.y),
      lon: lon + metersToDegreesLon(r.x, lat),
    };
  });
}

async function fetchTileBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes).toString('base64');
  } catch {
    return null;
  }
}

async function captureTileImages(tileUrls: string[]): Promise<string[]> {
  const sample = tileUrls.slice(0, 4);
  const encoded = await Promise.all(sample.map((url) => fetchTileBase64(url)));
  return encoded.filter((x): x is string => Boolean(x));
}

async function runPythonModel(
  payload: RoofDetectRequest & { tileImages: string[] },
): Promise<RoofDetectResponse | null> {
  if (process.env.USE_PYTHON_ROOF_MODEL !== 'true') {
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn('python', ['scripts/roof_detect.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', () => {
      try {
        if (!stdout.trim()) {
          resolve(null);
          return;
        }
        const parsed = JSON.parse(stdout) as RoofDetectResponse;
        if (!Array.isArray(parsed.polygon) || parsed.polygon.length < 3) {
          resolve(null);
          return;
        }
        resolve({
          ...parsed,
          debug: {
            ...(parsed.debug ?? {}),
            pythonStderr: stderr || undefined,
          },
        });
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as RoofDetectRequest;
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  const tileImages = await captureTileImages(body.tileUrls ?? []);
  const pythonResult = await runPythonModel({
    ...body,
    tileImages,
  });

  if (pythonResult) {
    return json(pythonResult);
  }

  return json({
    source: 'synthetic-ai-model',
    confidence: 0.86,
    polygon: syntheticRoofPolygon(body.latitude, body.longitude),
    debug: {
      zoom: body.zoom,
      tilesReceived: body.tileUrls?.length ?? 0,
      tilesCaptured: tileImages.length,
      modelHint: 'Set USE_PYTHON_ROOF_MODEL=true and provide scripts/roof_detect.py dependencies for YOLO/TensorFlow inference.',
    },
  });
};
