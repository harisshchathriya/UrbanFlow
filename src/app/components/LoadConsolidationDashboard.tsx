import { useEffect, useMemo, useRef, useState } from 'react';
import { Fuel, Truck, DollarSign, Route } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { LoadingSpinner } from './LoadingSpinner';
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import {
  ConsolidationDelivery,
  ConsolidationSuggestion,
  ConsolidationVehicle,
  matchLoads,
} from '../../engine/consolidation/LoadMatcher';

type RawRow = Record<string, unknown>;

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
  const googleMapsApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';

  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps',
    googleMapsApiKey,
  });

  const [vehicles, setVehicles] = useState<ConsolidationVehicle[]>([]);
  const [orders, setOrders] = useState<ConsolidationDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stableSuggestions, setStableSuggestions] = useState<ConsolidationSuggestion[]>([]);
  const suggestionsSigRef = useRef<string>('');

  const normalizeOrders = (rows: RawRow[]): ConsolidationDelivery[] => {
    return (rows || []).map((row) => ({
      id: toStringValue(getFirst(row, ['id', 'delivery_id'])),
      weight: toNumber(getFirst(row, ['weight', 'volume', 'quantity'])),
      from_lat: toNumber(getFirst(row, ['from_lat', 'pickup_lat', 'location_lat', 'pickup_latitude'])),
      from_lng: toNumber(getFirst(row, ['from_lng', 'pickup_lng', 'location_lng', 'pickup_longitude'])),
      to_lat: toNumber(getFirst(row, ['to_lat', 'drop_lat', 'delivery_latitude', 'drop_latitude'])),
      to_lng: toNumber(getFirst(row, ['to_lng', 'drop_lng', 'delivery_longitude', 'drop_longitude'])),
      status: toStringValue(getFirst(row, ['status'])) || 'pending',
    }));
  };

  const normalizeVehicles = (rows: RawRow[]): ConsolidationVehicle[] => {
    return (rows || []).map((row) => ({
      id: toStringValue(getFirst(row, ['id', 'vehicle_id'])),
      capacity: toNumber(getFirst(row, ['capacity'])),
      current_load: toNumber(getFirst(row, ['current_load', 'currentLoad'])),
      status: toStringValue(getFirst(row, ['status'])) || 'unknown',
      lat: toNumber(getFirst(row, ['latitude', 'lat', 'last_lat', 'current_latitude'])),
      lng: toNumber(getFirst(row, ['longitude', 'lng', 'last_lng', 'current_longitude'])),
    }));
  };

  const fetchPendingOrders = async (): Promise<ConsolidationDelivery[]> => {
    const importsRes = await supabase.from('delivery_imports').select('*').eq('status', 'pending');

    if (!importsRes.error) {
      return normalizeOrders((importsRes.data || []) as RawRow[]);
    }

    const deliveriesRes = await supabase.from('deliveries').select('*').eq('status', 'pending');

    if (!deliveriesRes.error) {
      return normalizeOrders((deliveriesRes.data || []) as RawRow[]);
    }

    throw new Error(importsRes.error?.message || deliveriesRes.error?.message || 'Failed to load pending orders');
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [vehiclesRes, ordersData] = await Promise.all([supabase.from('vehicles').select('*'), fetchPendingOrders()]);

        if (vehiclesRes.error) {
          setError(vehiclesRes.error?.message || 'Failed to load consolidation data');
          setVehicles([]);
          setOrders([]);
        } else {
          setVehicles(normalizeVehicles((vehiclesRes.data || []) as RawRow[]));
          setOrders(ordersData);
        }
      } catch (err) {
        setVehicles([]);
        setOrders([]);
        setError(err instanceof Error ? err.message : 'Failed to load consolidation data');
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('load_consolidation_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        void supabase
          .from('vehicles')
          .select('*')
          .then((r) => {
            if (!r.error) {
              setVehicles(normalizeVehicles((r.data || []) as RawRow[]));
            }
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_imports' }, () => {
        void fetchPendingOrders()
          .then((ordersData) => setOrders(ordersData))
          .catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh orders'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => {
        void fetchPendingOrders()
          .then((ordersData) => setOrders(ordersData))
          .catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh orders'));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
                }}
              >
                <PolylineF
                  path={previewSuggestion.route.map((point) => ({ lat: point[0], lng: point[1] }))}
                  options={{ strokeColor: '#22d3ee', strokeOpacity: 0.9, strokeWeight: 4 }}
                />

                <MarkerF
                  position={{
                    lat: previewSuggestion.route[0][0],
                    lng: previewSuggestion.route[0][1],
                  }}
                  label="S"
                  title="Vehicle Start"
                />

                {previewSuggestion.route.slice(1).map((point, idx) => (
                  <MarkerF
                    key={`stop-${idx}-${point[0]}-${point[1]}`}
                    position={{ lat: point[0], lng: point[1] }}
                    label={`${idx + 1}`}
                    title={`Stop ${idx + 1}`}
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
