import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { CO2Dashboard } from './CO2Dashboard';
import { LoadConsolidationDashboard } from './LoadConsolidationDashboard';
import { hasVerifiedRole } from '../auth/fallbackAuth';
import { supabase } from '../../services/supabaseClient';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Package,
  Route,
  Truck,
  Users,
} from 'lucide-react';

type DriverLive = {
  id: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  updatedAt: string | null;
  vehicleId: string | null;
  battery: number | null;
};

type DeliveryLive = {
  id: string;
  commodityName: string;
  quantity: number;
  status: string;
  driverId: string | null;
  eta: string | null;
  createdAt: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropLat: number | null;
  dropLng: number | null;
};

type KPIState = {
  totalDeliveries: number;
  activeDeliveries: number;
  completedDeliveries: number;
  delayedDeliveries: number;
  onTimePct: number;
  activeDrivers: number;
  alerts: number;
};

type AlertItem = {
  id: string;
  severity: 'warning' | 'danger';
  message: string;
};

type RouteSuggestion = {
  deliveryId: string;
  driverName: string;
  distanceKm: number;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const getFirstNumber = (row: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const parsed = toNumber(row[key]);
    if (parsed !== null) return parsed;
  }
  return null;
};

const getFirstString = (row: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
};

const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
};

const realtimeStatuses = new Set(['assigned', 'accepted', 'in_transit', 'moving', 'on_delivery']);

export function LogisticsOperatorDashboard() {
  const googleMapsApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps-logistics-operator',
    googleMapsApiKey,
  });

  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [fallbackAuthorized, setFallbackAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverLive[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryLive[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    const getSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setError(sessionError.message);
        setCheckingAuth(false);
        return;
      }
      if (!data.session) {
        const hasFallbackAccess = hasVerifiedRole('logistics-operator');
        if (!hasFallbackAccess) {
          navigate('/login/logistics-operator', { replace: true });
          return;
        }
        setFallbackAuthorized(true);
        setSession(null);
        setCheckingAuth(false);
        return;
      }
      setFallbackAuthorized(false);
      setSession(data.session);
      setCheckingAuth(false);
    };

    void getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        if (!hasVerifiedRole('logistics-operator')) {
          navigate('/login/logistics-operator', { replace: true });
          return;
        }
        setFallbackAuthorized(true);
        setSession(null);
        return;
      }
      setFallbackAuthorized(false);
      setSession(newSession);
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [navigate]);

  const hydrateDashboard = useCallback(async () => {
    try {
      setError(null);

      const [driverRes, vehicleStatusRes, deliveryRes] = await Promise.all([
        supabase.from('drivers').select('*'),
        supabase.from('vehicle_status').select('*'),
        supabase.from('delivery_imports').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      if (driverRes.error) throw new Error(driverRes.error.message);
      if (vehicleStatusRes.error) throw new Error(vehicleStatusRes.error.message);
      if (deliveryRes.error) throw new Error(deliveryRes.error.message);

      const vehicleByDriver = new Map<string, Record<string, unknown>>();
      const vehicleByVehicleId = new Map<string, Record<string, unknown>>();
      (vehicleStatusRes.data || []).forEach((raw) => {
        const row = raw as Record<string, unknown>;
        const driverId = getFirstString(row, ['driver_id']);
        const vehicleId = getFirstString(row, ['vehicle_id', 'id']);
        if (driverId) vehicleByDriver.set(driverId, row);
        if (vehicleId) vehicleByVehicleId.set(vehicleId, row);
      });

      const mappedDrivers = ((driverRes.data || []) as Record<string, unknown>[])
        .map((row) => {
          const id = getFirstString(row, ['id']) || '';
          const vehicleId = getFirstString(row, ['vehicle_id']);
          const matchedVehicle =
            (id ? vehicleByDriver.get(id) : undefined) ||
            (vehicleId ? vehicleByVehicleId.get(vehicleId) : undefined);

          const lat =
            getFirstNumber(row, ['current_latitude', 'last_lat', 'lat']) ??
            getFirstNumber(matchedVehicle || {}, ['latitude', 'lat']);
          const lng =
            getFirstNumber(row, ['current_longitude', 'last_lng', 'lng']) ??
            getFirstNumber(matchedVehicle || {}, ['longitude', 'lng']);

          if (lat === null || lng === null) return null;

          return {
            id,
            name: getFirstString(row, ['name', 'full_name']) || `Driver ${id.slice(0, 8)}`,
            status: (getFirstString(row, ['status']) || 'unknown').toLowerCase(),
            lat,
            lng,
            updatedAt: getFirstString(row, ['updated_at', 'last_location_updated_at']),
            vehicleId,
            battery: getFirstNumber(matchedVehicle || {}, ['battery_level']),
          } as DriverLive;
        })
        .filter((driver): driver is DriverLive => driver !== null);

      const mappedDeliveries = ((deliveryRes.data || []) as Record<string, unknown>[]).map((row) => ({
        id: getFirstString(row, ['id']) || '',
        commodityName: getFirstString(row, ['commodity_name', 'commodity']) || 'Unknown',
        quantity: getFirstNumber(row, ['quantity']) || 0,
        status: (getFirstString(row, ['status']) || 'pending').toLowerCase(),
        driverId: getFirstString(row, ['driver_id', 'assigned_driver_id']),
        eta: getFirstString(row, ['estimated_arrival', 'eta']),
        createdAt: getFirstString(row, ['created_at']),
        pickupLat: getFirstNumber(row, ['pickup_lat', 'pickup_latitude']),
        pickupLng: getFirstNumber(row, ['pickup_lng', 'pickup_longitude']),
        dropLat: getFirstNumber(row, ['drop_lat', 'drop_latitude']),
        dropLng: getFirstNumber(row, ['drop_lng', 'drop_longitude']),
      }));

      setDrivers(mappedDrivers);
      setDeliveries(mappedDeliveries);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session && !fallbackAuthorized) return;

    void hydrateDashboard();

    const driversChannel = supabase
      .channel('admin-drivers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => {
        void hydrateDashboard();
      })
      .subscribe();

    const vehicleStatusChannel = supabase
      .channel('admin-vehicle-status-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_status' }, () => {
        void hydrateDashboard();
      })
      .subscribe();

    const deliveriesChannel = supabase
      .channel('admin-deliveries-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_imports' }, () => {
        void hydrateDashboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(driversChannel);
      supabase.removeChannel(vehicleStatusChannel);
      supabase.removeChannel(deliveriesChannel);
    };
  }, [session, fallbackAuthorized, hydrateDashboard]);

  const kpi = useMemo<KPIState>(() => {
    const now = Date.now();
    const delivered = deliveries.filter((d) => d.status === 'delivered' || d.status === 'completed');
    const delayed = deliveries.filter((d) => {
      if (!d.eta) return false;
      if (d.status === 'delivered' || d.status === 'completed') return false;
      const etaMs = new Date(d.eta).getTime();
      return Number.isFinite(etaMs) && etaMs < now;
    });
    const onTimeDelivered = delivered.filter((d) => {
      if (!d.eta || !d.createdAt) return false;
      return new Date(d.createdAt).getTime() <= new Date(d.eta).getTime();
    }).length;
    const activeDrivers = drivers.filter((d) => realtimeStatuses.has(d.status)).length;

    return {
      totalDeliveries: deliveries.length,
      activeDeliveries: deliveries.filter((d) => realtimeStatuses.has(d.status)).length,
      completedDeliveries: delivered.length,
      delayedDeliveries: delayed.length,
      onTimePct: delivered.length > 0 ? Math.round((onTimeDelivered / delivered.length) * 100) : 0,
      activeDrivers,
      alerts: alerts.length,
    };
  }, [deliveries, drivers, alerts.length]);

  useEffect(() => {
    const now = Date.now();
    const generatedAlerts: AlertItem[] = [];

    drivers.forEach((driver) => {
      if (driver.battery !== null && driver.battery < 20) {
        generatedAlerts.push({
          id: `battery-${driver.id}`,
          severity: driver.battery < 10 ? 'danger' : 'warning',
          message: `${driver.name} battery low (${driver.battery}%).`,
        });
      }
      if (driver.updatedAt) {
        const staleMs = now - new Date(driver.updatedAt).getTime();
        if (Number.isFinite(staleMs) && staleMs > 2 * 60 * 1000) {
          generatedAlerts.push({
            id: `stale-${driver.id}`,
            severity: 'warning',
            message: `${driver.name} location is stale (>2 min).`,
          });
        }
      }
    });

    deliveries.forEach((delivery) => {
      if (!delivery.eta) return;
      const etaMs = new Date(delivery.eta).getTime();
      if (
        Number.isFinite(etaMs) &&
        etaMs < now &&
        delivery.status !== 'delivered' &&
        delivery.status !== 'completed'
      ) {
        generatedAlerts.push({
          id: `delay-${delivery.id}`,
          severity: 'danger',
          message: `${delivery.id} delayed beyond ETA.`,
        });
      }
    });

    setAlerts(generatedAlerts.slice(0, 6));
  }, [drivers, deliveries]);

  const suggestions = useMemo<RouteSuggestion[]>(() => {
    const idleDrivers = drivers.filter((d) => d.status === 'idle');
    const pendingDeliveries = deliveries.filter(
      (d) =>
        d.status === 'pending' &&
        d.pickupLat !== null &&
        d.pickupLng !== null
    );
    if (idleDrivers.length === 0) return [];

    return pendingDeliveries
      .map((delivery) => {
        let bestDriver = idleDrivers[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        idleDrivers.forEach((driver) => {
          const distance = getDistanceKm(
            driver.lat,
            driver.lng,
            delivery.pickupLat as number,
            delivery.pickupLng as number
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            bestDriver = driver;
          }
        });
        return {
          deliveryId: delivery.id,
          driverName: bestDriver.name,
          distanceKm: Math.round(bestDistance * 10) / 10,
        };
      })
      .slice(0, 5);
  }, [drivers, deliveries]);

  if (checkingAuth || initialLoading) {
    return (
      <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center">
        <p className="text-white text-xl">Loading dashboard...</p>
      </div>
    );
  }

  if (!session && !fallbackAuthorized) return null;

  return (
    <div className="min-h-screen urbanflow-gradient p-6">
      <div className="max-w-7xl mx-auto">
        <DashboardHeader
          title="Logistics Operator Dashboard"
          subtitle="Live command center for drivers, deliveries, and SmartRoute actions"
        />

        {error && (
          <GlassCard className="mb-6">
            <p className="text-red-300 text-sm">{error}</p>
          </GlassCard>
        )}

        {lastUpdated && !error && (
          <p className="text-xs text-muted-urban mb-4">
            Last synced: {new Date(lastUpdated).toLocaleTimeString()}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <KPICard icon={Package} label="Total Deliveries" value={kpi.totalDeliveries} />
          <KPICard icon={Truck} label="Active Deliveries" value={kpi.activeDeliveries} />
          <KPICard icon={Clock} label="Delayed Deliveries" value={kpi.delayedDeliveries} />
          <KPICard icon={Users} label="Active Drivers" value={kpi.activeDrivers} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <GlassCard className="lg:col-span-2">
            <h2 className="text-lg text-primary-urban mb-3">Live Driver Map</h2>
            <div className="h-96 rounded-xl overflow-hidden">
              {isGoogleLoaded ? (
                <GoogleMap
                  mapContainerClassName="h-full w-full"
                  center={{
                    lat: drivers[0]?.lat ?? 12.9716,
                    lng: drivers[0]?.lng ?? 77.5946,
                  }}
                  zoom={12}
                  options={{
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                  }}
                >
                  {drivers.map((driver) => (
                    <MarkerF
                      key={driver.id}
                      position={{ lat: driver.lat, lng: driver.lng }}
                      title={`${driver.name} | ${driver.status} | Battery: ${driver.battery ?? 'N/A'}%`}
                    />
                  ))}
                </GoogleMap>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-white/70 bg-black/20">
                  Loading Google Map...
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="text-lg text-primary-urban mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-300" />
              Live Alerts
            </h2>
            <div className="space-y-3">
              {alerts.length === 0 && (
                <p className="text-secondary-urban text-sm">No active alerts.</p>
              )}
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-xl text-sm ${
                    alert.severity === 'danger'
                      ? 'bg-red-500/20 text-red-100'
                      : 'bg-yellow-500/20 text-yellow-100'
                  }`}
                >
                  {alert.message}
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <GlassCard>
            <h2 className="text-lg text-primary-urban mb-3">Delivery Management</h2>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-muted-urban">
                    <th className="py-2">Delivery</th>
                    <th className="py-2">Commodity</th>
                    <th className="py-2">Qty</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.slice(0, 8).map((delivery) => (
                    <tr key={delivery.id} className="border-b border-white/5">
                      <td className="py-2 text-primary-urban">{delivery.id}</td>
                      <td className="py-2">{delivery.commodityName}</td>
                      <td className="py-2">{delivery.quantity}</td>
                      <td className="py-2 capitalize">{delivery.status.replace('_', ' ')}</td>
                      <td className="py-2">{delivery.eta ? new Date(delivery.eta).toLocaleTimeString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => navigate('/operator/deliveries')}
              className="glass-button px-4 py-2 rounded-xl flex items-center gap-2 text-white"
            >
              Manage Deliveries & CSV Import
              <ArrowRight className="w-4 h-4" />
            </button>
          </GlassCard>

          <GlassCard>
            <h2 className="text-lg text-primary-urban mb-3">SmartRoute+ Suggestions</h2>
            <div className="space-y-3">
              {suggestions.length === 0 && (
                <p className="text-secondary-urban text-sm">
                  No pending deliveries with assignable idle drivers right now.
                </p>
              )}
              {suggestions.map((item) => (
                <div key={item.deliveryId} className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                  <p className="text-primary-urban flex items-center gap-2">
                    <Route className="w-4 h-4" />
                    Assign {item.driverName} to {item.deliveryId}
                  </p>
                  <p className="text-xs text-muted-urban mt-1">{item.distanceKm} km from pickup</p>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-muted-urban">
              On-time: {kpi.onTimePct}% • Completed: {kpi.completedDeliveries} • Alerts: {kpi.alerts}
            </div>
          </GlassCard>
        </div>

        <LoadConsolidationDashboard />
        <CO2Dashboard />
      </div>
    </div>
  );
}
