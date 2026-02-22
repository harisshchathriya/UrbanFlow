import { useCallback, useEffect, useMemo, useRef, useState } from 'react';import { Fuel, Truck, DollarSign, Route } from 'lucide-react';import { supabase } from '../../services/supabaseClient';import { GlassCard } from './GlassCard';import { KPICard } from './KPICard';import { LoadingSpinner } from './LoadingSpinner';import { GoogleMap, PolylineF, useJsApiLoader } from '@react-google-maps/api';import { ConsolidationDelivery, ConsolidationSuggestion, ConsolidationVehicle, matchLoads } from '../../engine/consolidation/LoadMatcher';import { AdvancedMarker } from './maps/AdvancedMarker';import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';type RawRow = Record<string, unknown>;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
};

const toStringValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

const getFirst = (row: RawRow, keys: string[]): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return null;
};

export function LoadConsolidationDashboard() {
  const googleMapsApiKey = GOOGLE_MAPS_API_KEY;

  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps',
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
  });

  const [vehicles, setVehicles] = useState<ConsolidationVehicle[]>([]);
  const [orders, setOrders] = useState<ConsolidationDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stableSuggestions, setStableSuggestions] = useState<ConsolidationSuggestion[]>([]);
  const suggestionsSigRef = useRef<string>('');
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const normalizeOrders = useCallback((rows: RawRow[]): ConsolidationDelivery[] => {
    return (rows || []).map((row) => ({
      id: toStringValue(getFirst(row, ['id'])),
      weight: toNumber(getFirst(row, ['weight', 'volume', 'quantity'])) || 0,
      from_lat: toNumber(getFirst(row, ['from_lat'])) || 0,
      from_lng: toNumber(getFirst(row, ['from_lng'])) || 0,
      to_lat: toNumber(getFirst(row, ['to_lat'])) || 0,
      to_lng: toNumber(getFirst(row, ['to_lng'])) || 0,
      status: toStringValue(getFirst(row, ['status'])) || 'assigned',
    }));
  }, []);

  const normalizeVehicles = useCallback((vehicleRows: RawRow[], statusRows: RawRow[]): ConsolidationVehicle[] => {
    const statusByVehicleId = new Map<string, RawRow>();
    (statusRows || []).forEach((row) => {
      const id = toStringValue(getFirst(row, ['vehicle_id']));
      if (id) statusByVehicleId.set(id, row);
    });

    return (vehicleRows || []).map((row) => {
      const id = toStringValue(getFirst(row, ['id']));
      const statusRow = id ? statusByVehicleId.get(id) : undefined;
      return {
        id,
        capacity: toNumber(getFirst(row, ['capacity'])) || 0,
        current_load: toNumber(getFirst(row, ['current_load', 'currentLoad'])) || 0,
        status: toStringValue(getFirst(row, ['status'])) || 'unknown',
        lat: toNumber(getFirst(statusRow || {}, ['latitude'])) || 0,
        lng: toNumber(getFirst(statusRow || {}, ['longitude'])) || 0,
      };
    });
  }, []);

  const fetchPendingOrders = useCallback(async (): Promise<ConsolidationDelivery[]> => {
    const deliveriesRes = await supabase.from('deliveries').select('*').eq('status', 'assigned');

    if (!deliveriesRes.error) {
      return normalizeOrders((deliveriesRes.data || []) as RawRow[]);
    }

    throw new Error(deliveriesRes.error?.message || 'Failed to load assigned deliveries');
  }, [normalizeOrders]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [vehiclesRes, statusRes, ordersData] = await Promise.all([
          supabase.from('vehicles').select('*'),
          supabase.from('vehicle_status').select('*'),
          fetchPendingOrders(),
        ]);

        if (vehiclesRes.error || statusRes.error) {
          if (isMounted.current) {
            setError(vehiclesRes.error?.message || 'Failed to load consolidation data');
            setVehicles([]);
            setOrders([]);
          }
        } else {
          if (isMounted.current) {
            setVehicles(normalizeVehicles((vehiclesRes.data || []) as RawRow[], (statusRes.data || []) as RawRow[]));
            setOrders(ordersData);
          }
        }
      } catch (err) {
        if (isMounted.current) {
          setVehicles([]);
          setOrders([]);
          setError(err instanceof Error ? err.message : 'Failed to load consolidation data');
        }
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    };

    void fetchData();
  }, [fetchPendingOrders, normalizeVehicles]);

  useEffect(() => {
    const channel = supabase
      .channel('load_consolidation_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, (payload) => {
        const row = (payload.new || payload.old) as RawRow;
        const rowId = toStringValue(getFirst(row, ['id', 'vehicle_id']));
        if (!rowId) return;

        if (payload.eventType === 'DELETE') {
          setVehicles((prev) => prev.filter((vehicle) => vehicle.id !== rowId));
          return;
        }

        const normalized = normalizeVehicles([row])[0];
        if (!normalized) return;
        setVehicles((prev) => {
          const exists = prev.some((vehicle) => vehicle.id === normalized.id);
          if (!exists) return [normalized, ...prev];
          return prev.map((vehicle) => (vehicle.id === normalized.id ? normalized : vehicle));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, (payload) => {
        const row = (payload.new || payload.old) as RawRow;
        const rowId = toStringValue(getFirst(row, ['id', 'delivery_id']));
        if (!rowId) return;

        if (payload.eventType === 'DELETE') {
          setOrders((prev) => prev.filter((order) => order.id !== rowId));
          return;
        }

        const normalized = normalizeOrders([row])[0];
        if (!normalized || normalized.status !== 'assigned') {
          setOrders((prev) => prev.filter((order) => order.id !== rowId));
          return;
        }

        setOrders((prev) => {
          const exists = prev.some((order) => order.id === normalized.id);
          if (!exists) return [normalized, ...prev];
          return prev.map((order) => (order.id === normalized.id ? normalized : order));
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [normalizeOrders, normalizeVehicles]);

  const consolidation = useMemo(() => matchLoads(vehicles, orders), [vehicles, orders]);

  useEffect(() => {
    const nextSig = JSON.stringify(
      consolidation.suggestions.map((s) => ({
        vehicleId: s.vehicleId,
        deliveryIds: s.deliveryIds,
        score: s.score,
        distanceKm: s.distanceKm,
        durationMin: s.durationMin,
        savingsKm: s.savingsKm,
      }))
    );

    if (nextSig !== suggestionsSigRef.current) {
      suggestionsSigRef.current = nextSig;
      setStableSuggestions(consolidation.suggestions);
    }
  }, [consolidation.suggestions]);

  const avgUtilization = useMemo(() => {
    if (!stableSuggestions.length) return 0;
    const total = stableSuggestions.reduce((sum, s) => sum + s.utilization, 0);
    return total / stableSuggestions.length;
  }, [stableSuggestions]);

  const previewSuggestion = stableSuggestions[0] ?? null;
  const previewCenter = useMemo<[number, number]>(() => {
    if (!previewSuggestion || previewSuggestion.route.length === 0) {
      return [12.9716, 77.5946];
    }
    return previewSuggestion.route[0];
  }, [previewSuggestion]);

  if (loading) {
    return (
      <GlassCard className="p-8 flex justify-center items-center">
        <LoadingSpinner />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mt-6 bg-gradient-to-br from-blue-900/40 to-teal-800/40 border border-white/10 rounded-2xl backdrop-blur-md">
      <h2 className="text-xl text-primary-urban mb-4">Freight Load Consolidation Engine v2</h2>

      {error && <p className="text-sm text-red-300 mb-4">{error}</p>}

      <div className="mb-6 space-y-4">
        {vehicles.map((vehicle) => {
          const capacity = Number(vehicle.capacity) || 0;
          const load = Number(vehicle.current_load) || 0;
          const utilization = capacity > 0 ? (load / capacity) * 100 : 0;

          return (
            <div key={vehicle.id}>
              <div className="flex justify-between text-sm text-white/80 mb-1">
                <span>Vehicle {vehicle.id}</span>
                <span>{utilization.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
                <div className="h-3 bg-emerald-500 transition-all duration-500" style={{ width: `${utilization}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6">
        <h3 className="text-sm text-muted-urban mb-2">Savings-based Consolidation Suggestions</h3>

        <div className="space-y-2">
          {stableSuggestions.length === 0 && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70">
              No high-value consolidation bundle available right now.
            </div>
          )}

          {stableSuggestions.map((suggestion) => (
            <div key={`${suggestion.vehicleId}-${suggestion.deliveryIds.join('-')}`} className="p-3 rounded-xl bg-white/5 border border-cyan-500/20 text-sm text-white/90">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-cyan-300 font-medium">Vehicle {suggestion.vehicleId}</p>
                  <p>
                    Consolidate: {suggestion.deliveryIds.join(' + ')}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-100">Score {suggestion.score.toFixed(3)}</span>
              </div>

              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-white/80">
                <div>Distance: {suggestion.distanceKm.toFixed(1)} km</div>
                <div>Duration: {suggestion.durationMin} min</div>
                <div>Savings: {suggestion.savingsKm.toFixed(1)} km</div>
                <div>Utilization: {suggestion.utilization.toFixed(1)}%</div>
              </div>

              <div className="mt-2 text-xs text-white/70 flex items-center gap-1">
                <Route className="w-3 h-3" />
                Planned stops: {suggestion.route.length}
              </div>
            </div>
          ))}
        </div>
      </div>

      {previewSuggestion && previewSuggestion.route.length > 1 && (
        <div className="mb-6">
          <h3 className="text-sm text-muted-urban mb-2">Top Suggestion Route Preview</h3>
          <div className="rounded-xl overflow-hidden border border-white/10">
            {isGoogleLoaded ? (
              <GoogleMap
                mapContainerClassName="h-64 w-full"
                center={{ lat: previewCenter[0], lng: previewCenter[1] }}
                zoom={12}
                options={{
                  streetViewControl: false,
                  mapTypeControl: false,
                  fullscreenControl: false,
                  mapId: GOOGLE_MAP_ID || undefined,
                }}
              >
                <PolylineF
                  path={previewSuggestion.route.map((point) => ({ lat: point[0], lng: point[1] }))}
                  options={{ strokeColor: '#22d3ee', strokeOpacity: 0.9, strokeWeight: 4 }}
                />

                <AdvancedMarker
                  position={{
                    lat: previewSuggestion.route[0][0],
                    lng: previewSuggestion.route[0][1],
                  }}
                  title="Vehicle Start"
                  label="S"
                  color="#22d3ee"
                  enabled={Boolean(GOOGLE_MAP_ID)}
                />

                {previewSuggestion.route.slice(1).map((point, idx) => (
                  <AdvancedMarker
                    key={`stop-${idx}-${point[0]}-${point[1]}`}
                    position={{ lat: point[0], lng: point[1] }}
                    title={`Stop ${idx + 1}`}
                    label={`${idx + 1}`}
                    color="#6366f1"
                    enabled={Boolean(GOOGLE_MAP_ID)}
                  />
                ))}
              </GoogleMap>
            ) : (
              <div className="h-64 w-full flex items-center justify-center text-sm text-white/70 bg-black/20">
                Loading Google Map...
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard icon={Fuel} label="Fuel Saved" value={`${consolidation.fuelSaved} L`} />
        <KPICard icon={Truck} label="Trips Avoided" value={consolidation.tripsAvoided} />
        <KPICard icon={DollarSign} label="Cost Reduction" value={`INR ${consolidation.costSaved}`} />
      </div>

      <div className="mt-4 text-sm text-white/70">
        Average Utilization: <span className="text-emerald-400">{avgUtilization.toFixed(1)}%</span>
      </div>
    </GlassCard>
  );
}
