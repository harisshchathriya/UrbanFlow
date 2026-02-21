const toRad = (value: number) => (value * Math.PI) / 180;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const pointDistance = (a: LatLng, b: LatLng): number =>
  haversineDistance(a.lat, a.lng, b.lat, b.lng);

const routeAwareDistance = (directDistanceKm: number, trafficFactor: number): number => {
  // Frontend-safe proxy for road deviation; deterministic and stable.
  const deviationFactor = 1.08 + Math.min(0.18, (trafficFactor - 1) * 0.4);
  return directDistanceKm * deviationFactor;
};

const normalizeWeight = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

type LatLng = {
  lat: number;
  lng: number;
};

export type ConsolidationVehicle = {
  id: string;
  capacity: number;
  current_load: number;
  status?: string;
  lat?: number;
  lng?: number;
};

export type ConsolidationDelivery = {
  id: string;
  weight: number;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  status: string;
};

type ScoringWeights = {
  utilization: number;
  savings: number;
  costEfficiency: number;
  deviationPenalty: number;
  overloadRisk: number;
};

export type ConsolidationSuggestion = {
  vehicleId: string;
  deliveryIds: string[];
  orders: ConsolidationDelivery[];
  route: [number, number][];
  distanceKm: number;
  durationMin: number;
  savingsKm: number;
  savingsRatio: number;
  score: number;
  utilization: number;
};

type ClusterCompat = {
  vehicleId: string;
  orders: ConsolidationDelivery[];
  utilization: number;
};

export type ConsolidationResult = {
  clusters: ClusterCompat[];
  suggestions: ConsolidationSuggestion[];
  tripsAvoided: number;
  fuelSaved: number;
  costSaved: number;
};

const MAX_CANDIDATES_PER_VEHICLE = 24;
const MAX_BUNDLE_SIZE = 4;
const MAX_SEEDS = 8;
const MAX_PICKUP_RADIUS_KM = 30;
const BASE_AVG_SPEED_KMPH = 28;
const FUEL_PER_KM = 0.12;
const FUEL_PRICE = 100;
const COST_PER_KM = 14;

const normalizeVehiclePoint = (vehicle: ConsolidationVehicle): LatLng | null => {
  if (
    typeof vehicle.lat !== 'number' ||
    typeof vehicle.lng !== 'number' ||
    Number.isNaN(vehicle.lat) ||
    Number.isNaN(vehicle.lng)
  ) {
    return null;
  }
  return { lat: vehicle.lat, lng: vehicle.lng };
};

const getTrafficAwareWeights = (vehicle: ConsolidationVehicle, vehicles: ConsolidationVehicle[]) => {
  const vehiclePoint = normalizeVehiclePoint(vehicle);
  if (!vehiclePoint) {
    return {
      weights: {
        utilization: 0.4,
        savings: 0.3,
        costEfficiency: 0.1,
        deviationPenalty: 0.15,
        overloadRisk: 0.05,
      } satisfies ScoringWeights,
      trafficFactor: 1,
      localDensity: 0,
    };
  }

  const nearbyVehicles = vehicles.filter((other) => {
    if (other.id === vehicle.id) return false;
    const point = normalizeVehiclePoint(other);
    if (!point) return false;
    return pointDistance(vehiclePoint, point) <= 6;
  }).length;

  if (nearbyVehicles >= 5) {
    return {
      weights: {
        utilization: 0.5,
        savings: 0.25,
        costEfficiency: 0.08,
        deviationPenalty: 0.14,
        overloadRisk: 0.03,
      } satisfies ScoringWeights,
      trafficFactor: 1.2,
      localDensity: nearbyVehicles,
    };
  }

  if (nearbyVehicles <= 1) {
    return {
      weights: {
        utilization: 0.32,
        savings: 0.33,
        costEfficiency: 0.2,
        deviationPenalty: 0.1,
        overloadRisk: 0.05,
      } satisfies ScoringWeights,
      trafficFactor: 1.05,
      localDensity: nearbyVehicles,
    };
  }

  return {
    weights: {
      utilization: 0.4,
      savings: 0.3,
      costEfficiency: 0.1,
      deviationPenalty: 0.15,
      overloadRisk: 0.05,
    } satisfies ScoringWeights,
    trafficFactor: 1.12,
    localDensity: nearbyVehicles,
  };
};

const nearestOrder = (origin: LatLng, candidates: ConsolidationDelivery[], key: 'pickup' | 'drop') => {
  let nearest: ConsolidationDelivery | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const point: LatLng =
      key === 'pickup'
        ? { lat: candidate.from_lat, lng: candidate.from_lng }
        : { lat: candidate.to_lat, lng: candidate.to_lng };
    const d = pointDistance(origin, point);
    if (d < minDistance) {
      minDistance = d;
      nearest = candidate;
    }
  });

  return nearest;
};

const simulateBundleRoute = (
  vehiclePoint: LatLng,
  bundle: ConsolidationDelivery[],
  trafficFactor: number
) => {
  const pickupsRemaining = [...bundle];
  const dropsRemaining = [...bundle];
  const routeStops: LatLng[] = [vehiclePoint];

  let cursor = vehiclePoint;
  let directDistanceKm = 0;

  while (pickupsRemaining.length > 0) {
    const next = nearestOrder(cursor, pickupsRemaining, 'pickup');
    if (!next) break;
    const nextPoint = { lat: next.from_lat, lng: next.from_lng };
    directDistanceKm += pointDistance(cursor, nextPoint);
    routeStops.push(nextPoint);
    cursor = nextPoint;
    const idx = pickupsRemaining.findIndex((d) => d.id === next.id);
    if (idx >= 0) pickupsRemaining.splice(idx, 1);
  }

  while (dropsRemaining.length > 0) {
    const next = nearestOrder(cursor, dropsRemaining, 'drop');
    if (!next) break;
    const nextPoint = { lat: next.to_lat, lng: next.to_lng };
    directDistanceKm += pointDistance(cursor, nextPoint);
    routeStops.push(nextPoint);
    cursor = nextPoint;
    const idx = dropsRemaining.findIndex((d) => d.id === next.id);
    if (idx >= 0) dropsRemaining.splice(idx, 1);
  }

  const routeDistanceKm = routeAwareDistance(directDistanceKm, trafficFactor);
  const durationMin = Math.round((routeDistanceKm / BASE_AVG_SPEED_KMPH) * 60 * trafficFactor);
  return {
    routeDistanceKm: Math.round(routeDistanceKm * 10) / 10,
    durationMin,
    routeCoordinates: routeStops.map((p) => [p.lat, p.lng] as [number, number]),
  };
};

const evaluateBundleScore = (
  bundle: ConsolidationDelivery[],
  vehicle: ConsolidationVehicle,
  vehiclePoint: LatLng,
  weights: ScoringWeights,
  trafficFactor: number
) => {
  const vehicleCapacity = Math.max(1, normalizeWeight(vehicle.capacity));
  const currentLoad = normalizeWeight(vehicle.current_load);
  const availableCapacity = Math.max(0, vehicleCapacity - currentLoad);
  const bundleWeight = bundle.reduce((sum, d) => sum + normalizeWeight(d.weight), 0);

  const utilizationGain = availableCapacity > 0 ? clamp01(bundleWeight / availableCapacity) : 0;

  const baselineDistance = bundle.reduce((sum, d) => {
    const pickupPoint = { lat: d.from_lat, lng: d.from_lng };
    const dropPoint = { lat: d.to_lat, lng: d.to_lng };
    const directToPickup = pointDistance(vehiclePoint, pickupPoint);
    const pickupToDrop = pointDistance(pickupPoint, dropPoint);
    return sum + routeAwareDistance(directToPickup + pickupToDrop, trafficFactor);
  }, 0);

  const simulated = simulateBundleRoute(vehiclePoint, bundle, trafficFactor);
  const savingsKm = Math.max(0, baselineDistance - simulated.routeDistanceKm);
  const savingsRatio = baselineDistance > 0 ? clamp01(savingsKm / baselineDistance) : 0;

  const costSeparate = baselineDistance * COST_PER_KM;
  const costBundle = simulated.routeDistanceKm * COST_PER_KM;
  const costEfficiency =
    costSeparate > 0 ? clamp01((costSeparate - costBundle) / costSeparate) : 0;

  const extraDeviationKm = Math.max(0, simulated.routeDistanceKm - baselineDistance);
  const deviationPenalty = clamp01(Math.exp(Math.max(0, extraDeviationKm - 15) / 15) - 1);

  const fillRatio = vehicleCapacity > 0 ? (currentLoad + bundleWeight) / vehicleCapacity : 0;
  const overloadRisk = fillRatio > 0.9 ? clamp01((fillRatio - 0.9) / 0.1) : 0;

  const score =
    weights.utilization * utilizationGain +
    weights.savings * savingsRatio +
    weights.costEfficiency * costEfficiency -
    weights.deviationPenalty * deviationPenalty -
    weights.overloadRisk * overloadRisk;

  return {
    score: Math.round(score * 1000) / 1000,
    savingsKm: Math.round(savingsKm * 10) / 10,
    savingsRatio: Math.round(savingsRatio * 1000) / 1000,
    utilization: Math.round(clamp01(fillRatio) * 1000) / 10,
    baselineDistance: Math.round(baselineDistance * 10) / 10,
    routeDistanceKm: simulated.routeDistanceKm,
    durationMin: simulated.durationMin,
    routeCoordinates: simulated.routeCoordinates,
  };
};

const buildSavingsMatrix = (
  vehiclePoint: LatLng,
  candidates: ConsolidationDelivery[],
  trafficFactor: number
) => {
  const matrix = new Map<string, number>();

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const depotToA = routeAwareDistance(
        pointDistance(vehiclePoint, { lat: a.from_lat, lng: a.from_lng }),
        trafficFactor
      );
      const depotToB = routeAwareDistance(
        pointDistance(vehiclePoint, { lat: b.from_lat, lng: b.from_lng }),
        trafficFactor
      );
      const aToB = routeAwareDistance(
        pointDistance(
          { lat: a.from_lat, lng: a.from_lng },
          { lat: b.from_lat, lng: b.from_lng }
        ),
        trafficFactor
      );
      const savings = Math.max(0, depotToA + depotToB - aToB);
      matrix.set(`${a.id}|${b.id}`, savings);
      matrix.set(`${b.id}|${a.id}`, savings);
    }
  }

  return matrix;
};

const pairSavings = (matrix: Map<string, number>, a: string, b: string): number =>
  matrix.get(`${a}|${b}`) ?? 0;

const pickVehicleCandidates = (
  vehiclePoint: LatLng,
  deliveries: ConsolidationDelivery[]
) =>
  deliveries
    .map((delivery) => {
      const pickupDistance = pointDistance(vehiclePoint, {
        lat: delivery.from_lat,
        lng: delivery.from_lng,
      });
      return { delivery, pickupDistance };
    })
    .filter((item) => item.pickupDistance <= MAX_PICKUP_RADIUS_KM)
    .sort((a, b) => a.pickupDistance - b.pickupDistance)
    .slice(0, MAX_CANDIDATES_PER_VEHICLE)
    .map((item) => item.delivery);

const addDeliveryIfFits = (
  bundle: ConsolidationDelivery[],
  candidate: ConsolidationDelivery,
  availableCapacity: number
) => {
  const bundleWeight = bundle.reduce((sum, d) => sum + normalizeWeight(d.weight), 0);
  const candidateWeight = normalizeWeight(candidate.weight);
  if (bundleWeight + candidateWeight > availableCapacity) {
    return null;
  }
  return [...bundle, candidate];
};

const buildBestBundleForVehicle = (
  vehicle: ConsolidationVehicle,
  deliveries: ConsolidationDelivery[],
  allVehicles: ConsolidationVehicle[]
): ConsolidationSuggestion | null => {
  const vehiclePoint = normalizeVehiclePoint(vehicle);
  if (!vehiclePoint) return null;

  const availableCapacity = Math.max(0, normalizeWeight(vehicle.capacity) - normalizeWeight(vehicle.current_load));
  if (availableCapacity <= 0) return null;

  const candidates = pickVehicleCandidates(vehiclePoint, deliveries);
  if (candidates.length === 0) return null;

  const { weights, trafficFactor } = getTrafficAwareWeights(vehicle, allVehicles);
  const savingsMatrix = buildSavingsMatrix(vehiclePoint, candidates, trafficFactor);

  const seeds = [...candidates]
    .sort((a, b) => {
      const aPickup = pointDistance(vehiclePoint, { lat: a.from_lat, lng: a.from_lng });
      const bPickup = pointDistance(vehiclePoint, { lat: b.from_lat, lng: b.from_lng });
      return aPickup - bPickup;
    })
    .slice(0, MAX_SEEDS);

  let bestSuggestion: ConsolidationSuggestion | null = null;

  seeds.forEach((seed) => {
    let currentBundle: ConsolidationDelivery[] = addDeliveryIfFits([], seed, availableCapacity) ?? [];
    if (currentBundle.length === 0) return;

    let currentEval = evaluateBundleScore(currentBundle, vehicle, vehiclePoint, weights, trafficFactor);
    let expand = true;

    while (expand && currentBundle.length < MAX_BUNDLE_SIZE) {
      const remaining = candidates.filter((c) => !currentBundle.some((b) => b.id === c.id));
      let bestNext: ConsolidationDelivery | null = null;
      let bestNextEval = currentEval;

      remaining.forEach((candidate) => {
        const expanded = addDeliveryIfFits(currentBundle, candidate, availableCapacity);
        if (!expanded) return;

        const pairBonus =
          currentBundle.reduce((sum, item) => sum + pairSavings(savingsMatrix, item.id, candidate.id), 0) /
          Math.max(1, currentBundle.length);
        const expandedEval = evaluateBundleScore(expanded, vehicle, vehiclePoint, weights, trafficFactor);
        const boostedScore = expandedEval.score + Math.min(0.15, pairBonus / 20);

        if (boostedScore > bestNextEval.score + 0.02) {
          bestNext = candidate;
          bestNextEval = { ...expandedEval, score: Math.round(boostedScore * 1000) / 1000 };
        }
      });

      if (!bestNext) {
        expand = false;
      } else {
        currentBundle = [...currentBundle, bestNext];
        currentEval = bestNextEval;
      }
    }

    const suggestion: ConsolidationSuggestion = {
      vehicleId: vehicle.id,
      deliveryIds: currentBundle.map((d) => d.id),
      orders: currentBundle,
      route: currentEval.routeCoordinates,
      distanceKm: currentEval.routeDistanceKm,
      durationMin: currentEval.durationMin,
      savingsKm: currentEval.savingsKm,
      savingsRatio: currentEval.savingsRatio,
      score: currentEval.score,
      utilization: currentEval.utilization,
    };

    if (!bestSuggestion || suggestion.score > bestSuggestion.score) {
      bestSuggestion = suggestion;
    }
  });

  return bestSuggestion;
};

export function matchLoads(
  vehicles: ConsolidationVehicle[],
  deliveries: ConsolidationDelivery[]
): ConsolidationResult {
  const openDeliveries = deliveries.filter(
    (d) =>
      d.status === 'pending' &&
      Number.isFinite(d.from_lat) &&
      Number.isFinite(d.from_lng) &&
      Number.isFinite(d.to_lat) &&
      Number.isFinite(d.to_lng)
  );

  if (openDeliveries.length === 0 || vehicles.length === 0) {
    return {
      clusters: [],
      suggestions: [],
      tripsAvoided: 0,
      fuelSaved: 0,
      costSaved: 0,
    };
  }

  const suggestions = vehicles
    .map((vehicle) => buildBestBundleForVehicle(vehicle, openDeliveries, vehicles))
    .filter((item): item is ConsolidationSuggestion => item !== null)
    .sort((a, b) => b.score - a.score);

  const assignedDeliveryIds = new Set<string>();
  const uniqueSuggestions: ConsolidationSuggestion[] = [];

  suggestions.forEach((suggestion) => {
    const hasCollision = suggestion.deliveryIds.some((id) => assignedDeliveryIds.has(id));
    if (hasCollision) return;
    suggestion.deliveryIds.forEach((id) => assignedDeliveryIds.add(id));
    uniqueSuggestions.push(suggestion);
  });

  const clusters: ClusterCompat[] = uniqueSuggestions.map((suggestion) => ({
    vehicleId: suggestion.vehicleId,
    orders: suggestion.orders,
    utilization: suggestion.utilization,
  }));

  const groupedTrips = uniqueSuggestions.reduce((sum, s) => sum + s.deliveryIds.length, 0);
  const tripsAvoided = Math.max(0, groupedTrips - uniqueSuggestions.length);
  const totalSavingsKm = uniqueSuggestions.reduce((sum, s) => sum + s.savingsKm, 0);
  const fuelSaved = Math.round(totalSavingsKm * FUEL_PER_KM * 10) / 10;
  const costSaved = Math.round(fuelSaved * FUEL_PRICE);

  return {
    clusters,
    suggestions: uniqueSuggestions,
    tripsAvoided,
    fuelSaved,
    costSaved,
  };
}
