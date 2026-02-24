import type { LatLng } from './haversine';
import { haversineMeters, metersToKm } from './haversine';

const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY as string | undefined;

export type RouteEtaResult = {
  etaMinutes: number;
  distanceKm: number;
  polyline: Array<{ lat: number; lng: number }>;
  source: 'ors' | 'fallback';
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const buildFallbackEta = (from: LatLng, to: LatLng): RouteEtaResult => {
  const distanceKm = metersToKm(haversineMeters(from, to));
  const etaMinutes = Math.max(1, Math.round(distanceKm * 3.2));
  return {
    etaMinutes,
    distanceKm: round1(distanceKm),
    polyline: [from, to],
    source: 'fallback',
  };
};

export const fetchRouteEta = async (from: LatLng, to: LatLng): Promise<RouteEtaResult> => {
  if (!ORS_API_KEY) {
    return buildFallbackEta(from, to);
  }

  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        Authorization: ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        instructions: false,
      }),
    });

    if (!response.ok) {
      return buildFallbackEta(from, to);
    }

    const data = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: number[][] };
        properties?: { summary?: { duration?: number; distance?: number } };
      }>;
    };
    const feature = data.features?.[0];
    const summary = feature?.properties?.summary;
    const geometry = feature?.geometry?.coordinates;

    if (!summary || !geometry || geometry.length === 0) {
      return buildFallbackEta(from, to);
    }

    const polyline = geometry.map(([lng, lat]) => ({ lat, lng }));
    const distanceKm = (summary.distance ?? 0) / 1000;
    const etaMinutes = Math.max(1, Math.round((summary.duration ?? 0) / 60));

    return {
      etaMinutes,
      distanceKm: round1(distanceKm),
      polyline,
      source: 'ors',
    };
  } catch {
    return buildFallbackEta(from, to);
  }
};
