#!/usr/bin/env python3
"""
Optional roof-segmentation hook for the SvelteKit backend.

Behavior:
- Reads JSON payload from stdin:
  { latitude, longitude, zoom, tileUrls, tileImages[] }
- If ultralytics is available and USE_REAL_YOLO=true, you can wire real inference.
- Otherwise returns a deterministic synthetic polygon (safe fallback).
"""

import json
import math
import os
import sys
from typing import Any, Dict, List


def meters_to_deg_lat(meters: float) -> float:
    return meters / 111320.0


def meters_to_deg_lon(meters: float, lat: float) -> float:
    return meters / (111320.0 * math.cos(math.radians(lat)))


def rotate(x: float, y: float, angle_deg: float) -> Dict[str, float]:
    theta = math.radians(angle_deg)
    return {
        "x": x * math.cos(theta) - y * math.sin(theta),
        "y": x * math.sin(theta) + y * math.cos(theta),
    }


def synthetic_polygon(lat: float, lon: float) -> List[Dict[str, float]]:
    seed = abs(math.sin(lat * 12.345 + lon * 67.89))
    width = 14 + seed * 10
    height = 10 + seed * 8
    angle = 15 + seed * 60

    base = [
        {"x": -width / 2, "y": -height / 2},
        {"x": width / 2, "y": -height / 2},
        {"x": width / 2, "y": 0},
        {"x": width * 0.2, "y": 0},
        {"x": width * 0.2, "y": height / 2},
        {"x": -width / 2, "y": height / 2},
    ]

    polygon = []
    for p in base:
        r = rotate(p["x"], p["y"], angle)
        polygon.append(
            {
                "lat": lat + meters_to_deg_lat(r["y"]),
                "lon": lon + meters_to_deg_lon(r["x"], lat),
            }
        )
    return polygon


def maybe_run_real_model(payload: Dict[str, Any]) -> Dict[str, Any]:
    if os.getenv("USE_REAL_YOLO", "false").lower() != "true":
        raise RuntimeError("Real YOLO disabled")

    # Placeholder: wire your model here.
    # Example:
    # from ultralytics import YOLO
    # model = YOLO("roof-seg.pt")
    # decode tileImages[0], run model, convert mask -> polygon.
    raise RuntimeError("Real YOLO pipeline not configured")


def main() -> None:
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    lat = float(payload.get("latitude", 0.0))
    lon = float(payload.get("longitude", 0.0))

    try:
        result = maybe_run_real_model(payload)
        sys.stdout.write(json.dumps(result))
        return
    except Exception:
        pass

    fallback = {
        "source": "python-synthetic-fallback",
        "confidence": 0.8,
        "polygon": synthetic_polygon(lat, lon),
    }
    sys.stdout.write(json.dumps(fallback))


if __name__ == "__main__":
    main()
