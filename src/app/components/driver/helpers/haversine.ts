export type LatLng = {
  lat: number;
  lng: number;
};

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (value: number): number => (value * Math.PI) / 180;

export const haversineMeters = (from: LatLng, to: LatLng): number => {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
};

export const metersToKm = (meters: number): number => meters / 1000;
