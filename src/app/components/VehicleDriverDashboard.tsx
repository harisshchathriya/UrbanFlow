
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { GoogleMap, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import {
  AlertTriangle,
  BadgeCheck,
  BatteryCharging,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Fuel,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Route,
  ShieldAlert,
  Truck,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { supabase } from '../../services/supabaseClient';
import { hasVerifiedRole } from '../auth/fallbackAuth';
import { AdvancedMarker } from './maps/AdvancedMarker';
import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';
import { ProofOfDeliveryPanel } from './driver/ProofOfDeliveryPanel';
import { buildEarningsSummary } from './driver/helpers/earningsCalculator';
import { fetchRouteEta } from './driver/helpers/etaHelper';
import { haversineMeters, type LatLng } from './driver/helpers/haversine';

type ActiveTab = 'jobs' | 'navigate' | 'hub' | 'pod' | 'earnings' | 'vehicle' | 'completed';
type DeliveryStatus = 'assigned' | 'accepted' | 'in_transit' | 'completed' | 'rejected' | 'cancelled';

type Delivery = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: DeliveryStatus;
  priority: string | null;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  packages: number;
  created_at: string | null;
  delivered_at: string | null;
  eta_minutes: number | null;
  route_distance_km: number | null;
  route_duration_min: number | null;
  pod_image_url: string | null;
  pod_notes: string | null;
  otp_code: string | null;
  estimated_arrival: string | null;
};

type DeliveryRow = Record<string, unknown>;

type DriverRow = {
  id: string;
  name: string | null;
  status: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  current_delivery_id: string | null;
  last_location_updated_at: string | null;
  vehicle_id: string | null;
};

type DriverProfile = {
  id: string;
  name: string;
  status: string;
  currentLatitude: number | null;
  currentLongitude: number | null;
  currentDeliveryId: string | null;
  lastUpdatedAt: string | null;
  vehicleId: string | null;
};

type VehicleInfo = {
  id: string;
  maxCapacity: number;
  currentLoad: number;
  fuelPercent: number;
  batteryPercent: number;
  status: string;
};

type RouteState = {
  etaMinutes: number;
  distanceKm: number;
  polyline: Array<{ lat: number; lng: number }>;
  source: 'ors' | 'fallback';
  updatedAt: string;
};

type HubLocation = { id: string; name: string; lat: number; lng: number };
type ChargingStation = { id: string; name: string; lat: number; lng: number; availablePorts: number; status: 'open' | 'busy' };
type ChargingStationRow = Record<string, unknown>;

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['accepted', 'in_transit'];
const AQI_ALERT_THRESHOLD = 120;
const ETA_RECALCULATE_MS = 30000;
const ETA_MIN_MOVE_METERS = 50;
const EARNING_RATE_PER_KM = 18;
const HUBS: HubLocation[] = [
  { id: 'hub-1', name: 'North Hub', lat: 12.996, lng: 77.596 },
  { id: 'hub-2', name: 'Central Hub', lat: 12.972, lng: 77.593 },
  { id: 'hub-3', name: 'South Hub', lat: 12.931, lng: 77.61 },
];

const CHARGING_STATIONS: ChargingStation[] = [
  { id: 'cs-1', name: 'MG Road Fast Charge', lat: 12.9752, lng: 77.6087, availablePorts: 4, status: 'open' },
  { id: 'cs-2', name: 'Indiranagar EV Dock', lat: 12.9719, lng: 77.6412, availablePorts: 2, status: 'busy' },
  { id: 'cs-3', name: 'Koramangala Supercharger', lat: 12.9341, lng: 77.6149, availablePorts: 5, status: 'open' },
  { id: 'cs-4', name: 'Whitefield Charge Point', lat: 12.9698, lng: 77.7499, availablePorts: 3, status: 'open' },
  { id: 'cs-5', name: 'Yeshwanthpur EV Bay', lat: 13.0272, lng: 77.554, availablePorts: 1, status: 'busy' },
];

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseStatus = (value: unknown): DeliveryStatus => {
  const status = String(value ?? '').toLowerCase();
  if (status === 'assigned' || status === 'accepted' || status === 'in_transit' || status === 'completed' || status === 'rejected' || status === 'cancelled') return status;
  return 'assigned';
};

const normalizeDelivery = (row: DeliveryRow): Delivery => ({
  id: String(row.id ?? ''),
  driver_id: row.driver_id ? String(row.driver_id) : null,
  vehicle_id: row.vehicle_id ? String(row.vehicle_id) : null,
  status: parseStatus(row.status),
  priority: row.priority ? String(row.priority) : null,
  from_lat: toNumber(row.from_lat) ?? 0,
  from_lng: toNumber(row.from_lng) ?? 0,
  to_lat: toNumber(row.to_lat) ?? 0,
  to_lng: toNumber(row.to_lng) ?? 0,
  packages: Math.max(0, Math.round(toNumber(row.packages) ?? 1)),
  created_at: row.created_at ? String(row.created_at) : null,
  delivered_at: row.delivered_at ? String(row.delivered_at) : null,
  eta_minutes: toNumber(row.eta_minutes),
  route_distance_km: toNumber(row.route_distance_km),
  route_duration_min: toNumber(row.route_duration_min),
  pod_image_url: row.pod_image_url ? String(row.pod_image_url) : null,
  pod_notes: row.pod_notes ? String(row.pod_notes) : null,
  otp_code: row.otp_code ? String(row.otp_code) : null,
  estimated_arrival: row.estimated_arrival ? String(row.estimated_arrival) : null,
});

const normalizeDriver = (row: DriverRow): DriverProfile => ({
  id: row.id,
  name: row.name ?? 'Driver',
  status: (row.status ?? 'idle').toLowerCase(),
  currentLatitude: toNumber(row.current_latitude),
  currentLongitude: toNumber(row.current_longitude),
  currentDeliveryId: row.current_delivery_id,
  lastUpdatedAt: row.last_location_updated_at,
  vehicleId: row.vehicle_id,
});

const normalizeVehicleInfo = (row: Record<string, unknown>, fallbackId: string | null): VehicleInfo => ({
  id: String(row.id ?? fallbackId ?? ''),
  maxCapacity: toNumber(row.max_capacity ?? row.capacity) ?? 0,
  currentLoad: toNumber(row.current_load) ?? 0,
  fuelPercent: Math.max(0, Math.min(100, Math.round(toNumber(row.fuel_level) ?? 0))),
  batteryPercent: Math.max(0, Math.min(100, Math.round(toNumber(row.battery_level) ?? 0))),
  status: String(row.status ?? 'idle').toLowerCase(),
});

const normalizeChargingStation = (row: ChargingStationRow): ChargingStation | null => {
  const id = row.id ? String(row.id) : '';
  const lat = toNumber(row.lat ?? row.latitude);
  const lng = toNumber(row.lng ?? row.longitude);
  if (!id || lat === null || lng === null) return null;

  const statusRaw = String(row.status ?? 'open').toLowerCase();
  const status: 'open' | 'busy' = statusRaw === 'busy' ? 'busy' : 'open';

  return {
    id,
    name: String(row.name ?? `Station ${id.slice(0, 4)}`),
    lat,
    lng,
    availablePorts: Math.max(0, Math.round(toNumber(row.available_ports ?? row.availablePorts) ?? 0)),
    status,
  };
};

const isSameDayLocal = (value: string | null, now = new Date()): boolean => {
  if (!value) return false;
  const date = new Date(value);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

const makeAqiMock = (location: LatLng | null): { value: number; locationLabel: string } => {
  const base = 105;
  if (!location) return { value: base, locationLabel: 'your zone' };
  const variability = Math.round(Math.abs((location.lat * 13 + location.lng * 17) % 65));
  return { value: base + variability, locationLabel: `${location.lat.toFixed(3)}, ${location.lng.toFixed(3)}` };
};

const getStatusBadgeClass = (status: DeliveryStatus): string => {
  if (status === 'assigned') return 'bg-sky-500/20 text-sky-100 border border-sky-300/40';
  if (status === 'accepted') return 'bg-indigo-500/20 text-indigo-100 border border-indigo-300/40';
  if (status === 'in_transit') return 'bg-amber-500/20 text-amber-100 border border-amber-300/40';
  if (status === 'completed') return 'bg-emerald-500/20 text-emerald-100 border border-emerald-300/40';
  if (status === 'rejected') return 'bg-red-500/20 text-red-100 border border-red-300/40';
  return 'bg-zinc-500/20 text-zinc-100 border border-zinc-300/40';
};

const getPriorityBadgeClass = (priority: string | null): string => {
  const normalized = String(priority ?? '').toLowerCase();
  if (normalized === 'high' || normalized === 'urgent') return 'bg-red-500/20 text-red-100 border border-red-300/40';
  if (normalized === 'medium') return 'bg-amber-500/20 text-amber-100 border border-amber-300/40';
  return 'bg-cyan-500/20 text-cyan-100 border border-cyan-300/40';
};

export function VehicleDriverDashboard() {
  const googleMapsApiKey = GOOGLE_MAPS_API_KEY;
  const allowGuest = import.meta.env.VITE_ALLOW_GUEST_DASHBOARD === 'true' || import.meta.env.DEV;
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({ id: 'urbanflow-google-maps', googleMapsApiKey, libraries: MAP_LIBRARIES });

  const navigate = useNavigate();
  const { vehicleId } = useParams<{ vehicleId?: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [fallbackAuthorized, setFallbackAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolvingDriver, setResolvingDriver] = useState(true);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [jobsHydrating, setJobsHydrating] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobs');
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeWarning, setRouteWarning] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [aqiDismissed, setAqiDismissed] = useState(false);
  const [pendingPodDeliveryId, setPendingPodDeliveryId] = useState<string | null>(null);
  const [hubActionState, setHubActionState] = useState<string | null>(null);
  const [isEmergencySending, setIsEmergencySending] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'subscribed' | 'disconnected'>('connecting');
  const [chargingStations, setChargingStations] = useState<ChargingStation[]>(CHARGING_STATIONS);
  const [chartFocusIndex, setChartFocusIndex] = useState<number | null>(null);

  const isMountedRef = useRef(true);
  const lastEtaLocationRef = useRef<LatLng | null>(null);
  const lastGpsSyncLocationRef = useRef<LatLng | null>(null);
  const etaIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedChartRef = useRef<HTMLDivElement | null>(null);

  const activeDelivery = useMemo(() => {
    const sorted = [...deliveries]
      .filter((delivery) => ACTIVE_DELIVERY_STATUSES.includes(delivery.status) && (!!driverId ? delivery.driver_id === driverId : true))
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    return sorted[0] ?? null;
  }, [deliveries, driverId]);

  const availableDeliveries = useMemo(() => {
    return deliveries
      .filter((delivery) => delivery.status === 'assigned')
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  }, [deliveries]);

  const activeDeliveries = useMemo(() => {
    return deliveries
      .filter((delivery) => ACTIVE_DELIVERY_STATUSES.includes(delivery.status) && (!!driverId ? delivery.driver_id === driverId : true))
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  }, [deliveries, driverId]);

  const completedDeliveries = useMemo(() => {
    return deliveries
      .filter((delivery) => delivery.status === 'completed' && (!!driverId ? delivery.driver_id === driverId : true))
      .sort((a, b) => new Date(b.delivered_at ?? 0).getTime() - new Date(a.delivered_at ?? 0).getTime());
  }, [deliveries, driverId]);

  const completedTodayDeliveries = useMemo(() => {
    return completedDeliveries.filter((delivery) => isSameDayLocal(delivery.delivered_at ?? delivery.created_at));
  }, [completedDeliveries]);

  const aqiState = useMemo(() => makeAqiMock(userLocation), [userLocation]);

  const kpis = useMemo(() => {
    const totalDistanceKm = completedDeliveries.reduce((sum, delivery) => {
      if (delivery.route_distance_km && delivery.route_distance_km > 0) return sum + delivery.route_distance_km;
      return sum + haversineMeters({ lat: delivery.from_lat, lng: delivery.from_lng }, { lat: delivery.to_lat, lng: delivery.to_lng }) / 1000;
    }, 0);

    const onTimeCompleted = completedDeliveries.filter((delivery) => {
      if (!delivery.delivered_at) return false;
      if (!delivery.estimated_arrival) return true;
      return new Date(delivery.delivered_at).getTime() <= new Date(delivery.estimated_arrival).getTime();
    }).length;

    return {
      assignedJobs: availableDeliveries.length,
      activeDelivery: activeDelivery ? 1 : 0,
      deliveredToday: completedTodayDeliveries.length,
      distanceCoveredKm: Math.round(totalDistanceKm * 10) / 10,
      onTimeRate: completedDeliveries.length > 0 ? Math.round((onTimeCompleted / completedDeliveries.length) * 100) : 100,
    };
  }, [availableDeliveries.length, activeDelivery, completedTodayDeliveries.length, completedDeliveries]);

  const earningsSummary = useMemo(() => {
    return buildEarningsSummary(
      completedDeliveries.map((delivery) => ({
        id: delivery.id,
        delivered_at: delivery.delivered_at,
        route_distance_km:
          delivery.route_distance_km ??
          Math.round((haversineMeters({ lat: delivery.from_lat, lng: delivery.from_lng }, { lat: delivery.to_lat, lng: delivery.to_lng }) / 1000) * 10) / 10,
      })),
      EARNING_RATE_PER_KM
    );
  }, [completedDeliveries]);

  const nearestHub = useMemo(() => {
    if (!userLocation) return null;
    return HUBS.reduce((nearest, hub) => {
      const distance = haversineMeters(userLocation, { lat: hub.lat, lng: hub.lng });
      if (!nearest || distance < nearest.distanceM) return { hub, distanceM: distance };
      return nearest;
    }, null as { hub: HubLocation; distanceM: number } | null);
  }, [userLocation]);

  const chargingReferenceLocation = useMemo<LatLng | null>(() => {
    if (userLocation) return userLocation;
    if (driverProfile && driverProfile.currentLatitude !== null && driverProfile.currentLongitude !== null) {
      return { lat: driverProfile.currentLatitude, lng: driverProfile.currentLongitude };
    }
    if (activeDelivery) return { lat: activeDelivery.from_lat, lng: activeDelivery.from_lng };
    return null;
  }, [userLocation, driverProfile?.currentLatitude, driverProfile?.currentLongitude, activeDelivery]);

  const nearbyChargingStations = useMemo(() => {
    return chargingStations.map((station) => ({
      ...station,
      distanceKm:
        chargingReferenceLocation === null
          ? null
          : Math.round((haversineMeters(chargingReferenceLocation, { lat: station.lat, lng: station.lng }) / 1000) * 10) / 10,
    }))
      .sort((a, b) => {
        if (a.distanceKm === null && b.distanceKm === null) return a.name.localeCompare(b.name);
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      })
      .slice(0, 4);
  }, [chargingReferenceLocation, chargingStations]);

  const completedDeliveriesChart = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - offset));
      date.setHours(0, 0, 0, 0);
      return {
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        value: 0,
      };
    });

    const dayMap = new Map(days.map((entry) => [entry.key, entry]));
    for (const delivery of completedDeliveries) {
      const sourceDate = delivery.delivered_at ?? delivery.created_at;
      if (!sourceDate) continue;
      const date = new Date(sourceDate);
      if (Number.isNaN(date.getTime())) continue;
      const key = date.toISOString().slice(0, 10);
      const target = dayMap.get(key);
      if (target) target.value += 1;
    }

    const max = Math.max(1, ...days.map((entry) => entry.value));
    return { points: days, max };
  }, [completedDeliveries]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const resolveAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!hasVerifiedRole('vehicle-driver') && !allowGuest) {
          navigate('/login/vehicle-driver');
          return;
        }
        if (isMountedRef.current) {
          setFallbackAuthorized(true);
          setLoading(false);
        }
        return;
      }
      if (isMountedRef.current) {
        setFallbackAuthorized(false);
        setSession(data.session);
        setLoading(false);
      }
    };

    void resolveAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        if (!hasVerifiedRole('vehicle-driver') && !allowGuest) {
          navigate('/login/vehicle-driver');
          return;
        }
        if (isMountedRef.current) {
          setSession(null);
          setFallbackAuthorized(true);
        }
        return;
      }
      if (isMountedRef.current) {
        setSession(nextSession);
        setFallbackAuthorized(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [allowGuest, navigate]);

  useEffect(() => {
    const resolveDriverId = async () => {
      if (vehicleId) {
        setDriverId(vehicleId);
        setResolvingDriver(false);
        return;
      }
      if (session?.user?.id) {
        setDriverId(session.user.id);
        setResolvingDriver(false);
        return;
      }

      const { data } = await supabase.from('drivers').select('id').limit(1);
      if (data?.[0]?.id) setDriverId(data[0].id);
      setResolvingDriver(false);
    };

    void resolveDriverId();
  }, [vehicleId, session]);

  useEffect(() => {
    if (!driverId) return;

    const hydrate = async () => {
      setJobsHydrating(true);
      setRealtimeStatus('connecting');
      setUiError(null);
      const [deliveryRes, driverRes] = await Promise.all([
        supabase.from('deliveries').select('*').order('created_at', { ascending: false }),
        supabase.from('drivers').select('*').eq('id', driverId).maybeSingle(),
      ]);

      if (!deliveryRes.error) {
        setDeliveries(((deliveryRes.data ?? []) as DeliveryRow[]).map(normalizeDelivery));
      } else {
        setUiError('Unable to load deliveries.');
      }
      if (!driverRes.error && driverRes.data) {
        setDriverProfile(normalizeDriver(driverRes.data as DriverRow));
      } else if (driverRes.error) {
        setUiError('Unable to load driver profile.');
      }
      setJobsHydrating(false);
    };

    void hydrate();

    const realtimeChannel = supabase
      .channel(`driver-cockpit-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deleteId = String((payload.old as DeliveryRow).id ?? '');
          setDeliveries((prev) => prev.filter((delivery) => delivery.id !== deleteId));
          return;
        }

        const next = normalizeDelivery(payload.new as DeliveryRow);
        setDeliveries((prev) => {
          const exists = prev.some((delivery) => delivery.id === next.id);
          if (!exists) return [next, ...prev];
          return prev.map((delivery) => (delivery.id === next.id ? next : delivery));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers', filter: `id=eq.${driverId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setDriverProfile(null);
          return;
        }
        setDriverProfile(normalizeDriver(payload.new as DriverRow));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('subscribed');
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [driverId]);

  useEffect(() => {
    const hydrateVehicle = async () => {
      if (!activeDelivery?.vehicle_id && !driverProfile?.name) {
        setVehicleInfo(null);
        return;
      }

      const query = activeDelivery?.vehicle_id
        ? supabase.from('vehicles').select('*').eq('id', activeDelivery.vehicle_id).limit(1)
        : supabase.from('vehicles').select('*').ilike('driver_name', driverProfile?.name ?? '').limit(1);

      const { data, error } = await query;
      if (error || !data?.length) {
        setVehicleInfo(null);
        return;
      }

      const row = data[0] as Record<string, unknown>;
      const normalized = normalizeVehicleInfo(row, activeDelivery?.vehicle_id ?? null);
      setVehicleInfo({
        ...normalized,
        status: String(row.status ?? (activeDelivery ? 'delivering' : 'idle')).toLowerCase(),
      });
    };

    void hydrateVehicle();
  }, [activeDelivery, driverProfile?.name]);

  useEffect(() => {
    const targetVehicleId = activeDelivery?.vehicle_id ?? driverProfile?.vehicleId ?? vehicleInfo?.id ?? null;
    if (!targetVehicleId) return;

    const vehicleChannel = supabase
      .channel(`driver-vehicle-live-${targetVehicleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `id=eq.${targetVehicleId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setVehicleInfo(null);
          return;
        }
        const row = payload.new as Record<string, unknown>;
        setVehicleInfo(normalizeVehicleInfo(row, targetVehicleId));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(vehicleChannel);
    };
  }, [activeDelivery?.vehicle_id, driverProfile?.vehicleId, vehicleInfo?.id]);

  useEffect(() => {
    const hydrateChargingStations = async () => {
      const { data, error } = await supabase.from('charging_stations').select('*');
      if (error || !data?.length) return;
      const normalized = (data as ChargingStationRow[])
        .map((row) => normalizeChargingStation(row))
        .filter((row): row is ChargingStation => row !== null);
      if (normalized.length > 0) setChargingStations(normalized);
    };

    void hydrateChargingStations();

    const chargingChannel = supabase
      .channel('driver-charging-stations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'charging_stations' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = String((payload.old as ChargingStationRow).id ?? '');
          setChargingStations((prev) => prev.filter((station) => station.id !== id));
          return;
        }

        const row = normalizeChargingStation(payload.new as ChargingStationRow);
        if (!row) return;

        setChargingStations((prev) => {
          const exists = prev.some((station) => station.id === row.id);
          if (!exists) return [row, ...prev];
          return prev.map((station) => (station.id === row.id ? row : station));
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(chargingChannel);
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation || !gpsEnabled) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationError(null);
      },
      (error) => setLocationError(`Location error: ${error.message}`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [gpsEnabled]);

  useEffect(() => {
    if (!driverId || !userLocation) return;
    const previous = lastGpsSyncLocationRef.current;
    const movedMeters = previous ? haversineMeters(previous, userLocation) : Infinity;
    if (movedMeters < 20) return;

    lastGpsSyncLocationRef.current = userLocation;
    void supabase
      .from('drivers')
      .update({
        current_latitude: userLocation.lat,
        current_longitude: userLocation.lng,
        current_delivery_id: activeDelivery?.id ?? null,
        status: activeDelivery ? 'delivering' : 'idle',
        last_location_updated_at: new Date().toISOString(),
      })
      .eq('id', driverId);
  }, [driverId, userLocation, activeDelivery]);

  const recalculateEta = useCallback(
    async (force = false) => {
      if (!activeDelivery || !userLocation) return;
      const movedMeters = lastEtaLocationRef.current ? haversineMeters(lastEtaLocationRef.current, userLocation) : Infinity;
      if (!force && movedMeters < ETA_MIN_MOVE_METERS) return;

      setRouteLoading(true);
      const nextRoute = await fetchRouteEta(userLocation, { lat: activeDelivery.to_lat, lng: activeDelivery.to_lng });
      lastEtaLocationRef.current = userLocation;
      setRouteState({
        etaMinutes: nextRoute.etaMinutes,
        distanceKm: nextRoute.distanceKm,
        polyline: nextRoute.polyline,
        source: nextRoute.source,
        updatedAt: new Date().toISOString(),
      });
      setRouteWarning(nextRoute.source === 'fallback' ? 'ORS unavailable. Showing fallback ETA.' : null);
      setRouteLoading(false);
    },
    [activeDelivery, userLocation]
  );

  useEffect(() => {
    if (!activeDelivery) {
      setRouteState(null);
      setRouteWarning(null);
      if (etaIntervalRef.current) clearInterval(etaIntervalRef.current);
      return;
    }

    void recalculateEta(true);
    if (etaIntervalRef.current) clearInterval(etaIntervalRef.current);
    etaIntervalRef.current = setInterval(() => void recalculateEta(false), ETA_RECALCULATE_MS);

    return () => {
      if (etaIntervalRef.current) clearInterval(etaIntervalRef.current);
    };
  }, [activeDelivery, recalculateEta]);

  const handleAccept = async (delivery: Delivery) => {
    setUiError(null);
    if (!driverId) return;
    setActionLoadingId(`accept-${delivery.id}`);
    if (activeDelivery && activeDelivery.id !== delivery.id) {
      setUiError('You already have an active delivery. Complete it first.');
      setActionLoadingId(null);
      return;
    }
    const activeCheck = await supabase
      .from('deliveries')
      .select('id')
      .eq('driver_id', driverId)
      .in('status', ['accepted', 'in_transit'])
      .neq('id', delivery.id)
      .limit(1);

    if (activeCheck.error) {
      setUiError('Unable to verify active deliveries.');
      setActionLoadingId(null);
      return;
    }
    if ((activeCheck.data ?? []).length > 0) {
      setUiError('You already have an active delivery. Complete it first.');
      setActionLoadingId(null);
      return;
    }

    const rpc = await supabase.rpc('accept_delivery_atomic', { p_delivery_id: delivery.id, p_driver_id: driverId });
    if (!rpc.error && rpc.data === false) {
      setUiError('Job already taken or unavailable.');
      setActionLoadingId(null);
      return;
    }

    if (rpc.error) {
      const fallbackResult = await supabase
        .from('deliveries')
        .update({ status: 'accepted', driver_id: driverId })
        .eq('id', delivery.id)
        .eq('status', 'assigned')
        .select('id')
        .maybeSingle();
      if (fallbackResult.error || !fallbackResult.data) {
        setUiError('Job already taken or unavailable.');
        setActionLoadingId(null);
        return;
      }
    }

    setDeliveries((prev) =>
      prev.map((item) => (item.id === delivery.id ? { ...item, status: 'accepted', driver_id: driverId } : item))
    );

    setActiveTab('navigate');
    const profileLocation =
      driverProfile && driverProfile.currentLatitude !== null && driverProfile.currentLongitude !== null
        ? { lat: driverProfile.currentLatitude, lng: driverProfile.currentLongitude }
        : null;
    const startLocation = userLocation ?? profileLocation;
    if (!startLocation) {
      setRouteWarning('Enable GPS to visualize ORS route from your live location.');
      setRouteState(null);
      setActionLoadingId(null);
      return;
    }

    setRouteLoading(true);
    const nextRoute = await fetchRouteEta(startLocation, { lat: delivery.to_lat, lng: delivery.to_lng });
    setRouteState({
      etaMinutes: nextRoute.etaMinutes,
      distanceKm: nextRoute.distanceKm,
      polyline: nextRoute.polyline,
      source: nextRoute.source,
      updatedAt: new Date().toISOString(),
    });
    setRouteWarning(nextRoute.source === 'fallback' ? 'ORS unavailable. Showing fallback ETA.' : null);
    setRouteLoading(false);
    setActionLoadingId(null);
  };

  const handleReject = async (delivery: Delivery) => {
    setUiError(null);
    if (!driverId) return;
    setActionLoadingId(`reject-${delivery.id}`);
    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'rejected' })
      .eq('id', delivery.id)
      .eq('status', 'assigned');
    if (error) setUiError('Unable to reject delivery.');
    setActionLoadingId(null);
  };

  const handleStartTrip = async (delivery: Delivery) => {
    setUiError(null);
    if (!driverId) return;
    setActionLoadingId(`start-${delivery.id}`);
    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'in_transit' })
      .eq('id', delivery.id)
      .eq('driver_id', driverId)
      .eq('status', 'accepted');
    if (error) setUiError('Unable to start trip. Delivery may already be in progress.');
    setActionLoadingId(null);
  };

  const handleMarkDelivered = async (delivery: Delivery) => {
    setUiError(null);
    if (!driverId) {
      setUiError('Driver profile unavailable.');
      return;
    }
    setActionLoadingId(`delivered-${delivery.id}`);

    if (etaIntervalRef.current) {
      clearInterval(etaIntervalRef.current);
      etaIntervalRef.current = null;
    }
    setRouteState(null);
    setRouteWarning(null);
    setActiveTab('jobs');

    const deliveredAt = new Date().toISOString();
    const primaryUpdate = await supabase
      .from('deliveries')
      .update({ status: 'completed', delivered_at: deliveredAt })
      .eq('id', delivery.id)
      .eq('driver_id', driverId)
      .in('status', ['accepted', 'in_transit']);

    if (primaryUpdate.error) {
      const fallbackUpdate = await supabase
        .from('deliveries')
        .update({ status: 'completed' })
        .eq('id', delivery.id)
        .eq('driver_id', driverId)
        .in('status', ['accepted', 'in_transit']);

      if (fallbackUpdate.error) {
        setUiError(fallbackUpdate.error.message || primaryUpdate.error.message || 'Unable to mark delivery as completed.');
        setActionLoadingId(null);
        return;
      }
    }

    setDeliveries((prev) =>
      prev.map((item) => (item.id === delivery.id ? { ...item, status: 'completed', delivered_at: deliveredAt } : item))
    );
    if (driverId) {
      void supabase.from('drivers').update({ status: 'idle', current_delivery_id: null }).eq('id', driverId);
    }
    setActionLoadingId(null);
  };

  const handlePodSuccess = async ({ imageUrl, notes }: { imageUrl: string; notes: string }) => {
    if (!pendingPodDeliveryId) return;

    const deliveredAt = new Date().toISOString();
    const fullUpdate = await supabase
      .from('deliveries')
      .update({ status: 'completed', delivered_at: deliveredAt, pod_image_url: imageUrl, pod_notes: notes })
      .eq('id', pendingPodDeliveryId)
      .eq('status', 'in_transit');

    if (fullUpdate.error) {
      const fallback = await supabase.from('deliveries').update({ status: 'completed' }).eq('id', pendingPodDeliveryId).eq('status', 'in_transit');
      if (fallback.error) {
        setUiError('Failed to complete delivery after POD submission.');
        return;
      }
    }

    if (driverId) {
      await supabase.from('drivers').update({ status: 'idle', current_delivery_id: null }).eq('id', driverId);
    }

    setGpsEnabled(false);
    setPendingPodDeliveryId(null);
    setActiveTab('completed');
  };

  const handleHubAction = async (action: 'refuel' | 'recharge' | 'arrive') => {
    if (!driverId) return;
    if (action === 'arrive' && !nearestHub) {
      setHubActionState('No nearby hub found.');
      return;
    }

    const { error } = await supabase
      .from('drivers')
      .update({ status: action === 'arrive' ? 'at_hub' : action, current_delivery_id: null, last_location_updated_at: new Date().toISOString() })
      .eq('id', driverId);

    if (error) {
      setHubActionState('Hub update failed.');
      return;
    }

    setHubActionState(action === 'arrive' && nearestHub ? `Arrived at ${nearestHub.hub.name}.` : action === 'refuel' ? 'Refuel marked.' : 'Recharge marked.');
  };

  const handleEmergency = async () => {
    if (!driverId || !userLocation || isEmergencySending) return;
    setIsEmergencySending(true);
    setUiError(null);

    const insert = await supabase.from('emergency_alerts').insert({
      driver_id: driverId,
      location: userLocation,
      timestamp: new Date().toISOString(),
      status: 'active',
    });

    if (insert.error) {
      const fallback = await supabase.from('emergency_alerts').insert({ driver_id: driverId, status: 'active' });
      if (fallback.error) setUiError('Emergency alert failed.');
    }

    setIsEmergencySending(false);
  };

  const updateChartFocusFromClientX = useCallback(
    (clientX: number) => {
      const chartEl = completedChartRef.current;
      if (!chartEl || completedDeliveriesChart.points.length === 0) return;
      const rect = chartEl.getBoundingClientRect();
      const relativeX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const index = Math.min(
        completedDeliveriesChart.points.length - 1,
        Math.max(0, Math.floor((relativeX / Math.max(rect.width, 1)) * completedDeliveriesChart.points.length))
      );
      setChartFocusIndex(index);
    },
    [completedDeliveriesChart.points.length]
  );

  const handleChartMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    updateChartFocusFromClientX(event.clientX);
  };

  const handleChartTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateChartFocusFromClientX(touch.clientX);
  };

  if (loading || resolvingDriver) {
    return <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center"><p className="text-white text-xl">Loading dashboard...</p></div>;
  }

  if (!session && !fallbackAuthorized && !allowGuest) {
    return <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center"><p className="text-white text-xl">Redirecting to login...</p></div>;
  }

  return (
    <div className="min-h-screen urbanflow-gradient p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <DashboardHeader title="Vehicle Driver Dashboard" subtitle={`Driver: ${driverId?.slice(0, 8) ?? 'N/A'} | ${activeDelivery ? 'Active Delivery' : 'Idle'}`} />

        {aqiState.value > AQI_ALERT_THRESHOLD && !aqiDismissed && (
          <div className="rounded-2xl bg-orange-500/85 text-white px-5 py-4 shadow-xl flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <p className="font-medium">AQI high near {aqiState.locationLabel}. Consider alternate route.</p>
            </div>
            <button type="button" className="text-sm px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30" onClick={() => setAqiDismissed(true)}>Dismiss</button>
          </div>
        )}

        {uiError && <div className="rounded-2xl bg-red-500/80 text-white px-4 py-3 shadow-xl">{uiError}</div>}
        {locationError && <div className="rounded-2xl bg-yellow-500/80 text-white px-4 py-3 shadow-xl">{locationError}</div>}
        {realtimeStatus !== 'subscribed' && (
          <div className="rounded-2xl bg-amber-500/75 text-white px-4 py-3 shadow-xl">
            Realtime sync {realtimeStatus === 'connecting' ? 'connecting...' : 'disconnected. Reconnecting...'}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-2xl p-4 shadow-xl bg-gradient-to-br from-sky-500/25 to-sky-700/20 border border-sky-300/20">
            <p className="text-sm text-secondary-urban">Assigned Jobs</p>
            <p className="text-3xl text-white mt-1">{kpis.assignedJobs}</p>
          </div>
          <div className="rounded-2xl p-4 shadow-xl bg-gradient-to-br from-indigo-500/25 to-indigo-700/20 border border-indigo-300/20">
            <p className="text-sm text-secondary-urban">Active Delivery</p>
            <p className="text-3xl text-white mt-1">{kpis.activeDelivery}</p>
          </div>
          <div className="rounded-2xl p-4 shadow-xl bg-gradient-to-br from-emerald-500/25 to-emerald-700/20 border border-emerald-300/20">
            <p className="text-sm text-secondary-urban">Completed Today</p>
            <p className="text-3xl text-white mt-1">{kpis.deliveredToday}</p>
          </div>
          <div className="rounded-2xl p-4 shadow-xl bg-gradient-to-br from-cyan-500/25 to-cyan-700/20 border border-cyan-300/20">
            <p className="text-sm text-secondary-urban">Distance Covered</p>
            <p className="text-3xl text-white mt-1">{kpis.distanceCoveredKm} km</p>
          </div>
        </div>

        <div className="rounded-2xl shadow-xl bg-white/10 backdrop-blur-md border border-white/20 p-2 overflow-x-auto">
          <div className="flex min-w-max gap-2">
            {([
              ['jobs', "Today's Jobs", Package],
              ['navigate', 'Navigate', Navigation],
              ['hub', 'Hub Actions', Warehouse],
              ['pod', 'Proof of Delivery', BadgeCheck],
              ['earnings', 'Earnings', Wallet],
              ['vehicle', 'Vehicle', Truck],
              ['completed', `Completed (${completedDeliveries.length})`, CheckCircle2],
            ] as Array<[ActiveTab, string, typeof Package]>).map(([tab, label, Icon]) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${activeTab === tab ? 'bg-cyan-500/40 text-white glow-cyan' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}><Icon className="w-4 h-4" />{label}</button>
            ))}
          </div>
        </div>

        {activeTab === 'jobs' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl text-primary-urban">Operations Board</h2>
              <span className="text-sm text-secondary-urban">{availableDeliveries.length + activeDeliveries.length + completedTodayDeliveries.length} tracked</span>
            </div>

            {jobsHydrating && (
              <div className="space-y-4 mb-6">
                {[1, 2, 3].map((idx) => (
                  <div key={idx} className="rounded-2xl border border-white/20 bg-white/10 p-4 animate-pulse">
                    <div className="h-4 w-40 bg-white/20 rounded mb-3" />
                    <div className="h-3 w-64 bg-white/15 rounded mb-2" />
                    <div className="h-3 w-52 bg-white/15 rounded" />
                  </div>
                ))}
              </div>
            )}

            {!jobsHydrating && (
              <div className="space-y-8">
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg text-primary-urban">Available Deliveries</h3>
                    <span className="text-xs px-2 py-1 rounded-full bg-sky-500/20 text-sky-100 border border-sky-300/40">{availableDeliveries.length} assigned</span>
                  </div>
                  <div className="space-y-3">
                    {availableDeliveries.map((delivery) => (
                      <div key={delivery.id} className="rounded-2xl border border-sky-300/25 bg-gradient-to-br from-sky-500/10 to-cyan-500/10 p-4 shadow-xl transition hover:-translate-y-0.5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-primary-urban font-medium">Order #{delivery.id.slice(0, 8)}</p>
                            <p className="text-xs text-muted-urban mt-1">Pickup: {delivery.from_lat.toFixed(5)}, {delivery.from_lng.toFixed(5)}</p>
                            <p className="text-xs text-muted-urban">Drop: {delivery.to_lat.toFixed(5)}, {delivery.to_lng.toFixed(5)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded-full capitalize ${getStatusBadgeClass(delivery.status)}`}>{delivery.status.replace('_', ' ')}</span>
                            <span className={`text-xs px-2 py-1 rounded-full capitalize ${getPriorityBadgeClass(delivery.priority)}`}>{delivery.priority ?? 'normal'}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={actionLoadingId !== null}
                            onClick={() => void handleAccept(delivery)}
                            className="px-4 py-2 rounded-xl bg-emerald-500/30 hover:bg-emerald-500/45 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
                          >
                            {actionLoadingId === `accept-${delivery.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Accepting</span> : 'ACCEPT'}
                          </button>
                          <button
                            type="button"
                            disabled={actionLoadingId !== null}
                            onClick={() => void handleReject(delivery)}
                            className="px-4 py-2 rounded-xl bg-red-500/30 hover:bg-red-500/45 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
                          >
                            {actionLoadingId === `reject-${delivery.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Rejecting</span> : 'REJECT'}
                          </button>
                        </div>
                      </div>
                    ))}
                    {availableDeliveries.length === 0 && (
                      <div className="rounded-2xl border border-white/20 bg-white/5 p-8 text-center">
                        <ClipboardList className="w-10 h-10 text-white/60 mx-auto mb-3" />
                        <p className="text-secondary-urban">No available deliveries right now.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg text-primary-urban">Active Delivery</h3>
                    <span className="text-xs px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-100 border border-indigo-300/40">{activeDeliveries.length} active</span>
                  </div>
                  <div className="space-y-3">
                    {activeDeliveries.map((delivery) => {
                      const distKm = Math.round((haversineMeters({ lat: delivery.from_lat, lng: delivery.from_lng }, { lat: delivery.to_lat, lng: delivery.to_lng }) / 1000) * 10) / 10;
                      const etaText = activeDelivery?.id === delivery.id && routeState ? `${routeState.etaMinutes} min` : delivery.eta_minutes ? `${delivery.eta_minutes} min` : 'Pending';
                      return (
                        <div
                          key={delivery.id}
                          className={`rounded-2xl border p-4 shadow-xl transition hover:-translate-y-0.5 ${
                            activeDelivery?.id === delivery.id
                              ? 'bg-gradient-to-br from-indigo-500/20 to-cyan-500/15 border-cyan-300/45 shadow-[0_0_28px_rgba(34,211,238,0.35)]'
                              : 'bg-gradient-to-br from-indigo-500/12 to-indigo-700/10 border-indigo-300/25'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-primary-urban font-medium">Order #{delivery.id.slice(0, 8)}</p>
                              <p className="text-xs text-muted-urban mt-1">Pickup: {delivery.from_lat.toFixed(5)}, {delivery.from_lng.toFixed(5)}</p>
                              <p className="text-xs text-muted-urban">Drop: {delivery.to_lat.toFixed(5)}, {delivery.to_lng.toFixed(5)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-1 rounded-full capitalize ${getStatusBadgeClass(delivery.status)}`}>{delivery.status.replace('_', ' ')}</span>
                              <span className={`text-xs px-2 py-1 rounded-full capitalize ${getPriorityBadgeClass(delivery.priority)}`}>{delivery.priority ?? 'normal'}</span>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="rounded-xl bg-black/20 border border-white/10 p-2">
                              <p className="text-[11px] text-muted-urban">ETA</p>
                              <p className="text-sm text-white">{etaText}</p>
                            </div>
                            <div className="rounded-xl bg-black/20 border border-white/10 p-2">
                              <p className="text-[11px] text-muted-urban">Distance</p>
                              <p className="text-sm text-white">{routeState && activeDelivery?.id === delivery.id ? `${routeState.distanceKm} km` : `${distKm} km`}</p>
                            </div>
                            <div className="rounded-xl bg-black/20 border border-white/10 p-2">
                              <p className="text-[11px] text-muted-urban">Packages</p>
                              <p className="text-sm text-white">{delivery.packages}</p>
                            </div>
                            <div className="rounded-xl bg-black/20 border border-white/10 p-2">
                              <p className="text-[11px] text-muted-urban">Route</p>
                              <p className="text-sm text-white">{routeState?.source === 'fallback' ? 'Fallback ETA' : 'ORS'}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {delivery.status === 'accepted' && (
                              <>
                                <button
                                  type="button"
                                  disabled={actionLoadingId !== null}
                                  onClick={() => void handleStartTrip(delivery)}
                                  className="px-4 py-2 rounded-xl bg-amber-500/35 hover:bg-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
                                >
                                  {actionLoadingId === `start-${delivery.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Starting</span> : 'Start Trip'}
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoadingId !== null}
                                  onClick={() => void handleMarkDelivered(delivery)}
                                  className="px-4 py-2 rounded-xl bg-emerald-500/30 hover:bg-emerald-500/45 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
                                >
                                  {actionLoadingId === `delivered-${delivery.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Completing</span> : 'Mark Delivered'}
                                </button>
                              </>
                            )}
                            {delivery.status === 'in_transit' && (
                              <>
                                <button
                                  type="button"
                                  disabled={actionLoadingId !== null}
                                  onClick={() => void handleMarkDelivered(delivery)}
                                  className="px-4 py-2 rounded-xl bg-emerald-500/30 hover:bg-emerald-500/45 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
                                >
                                  {actionLoadingId === `delivered-${delivery.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Completing</span> : 'Mark Delivered'}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {activeDeliveries.length === 0 && (
                      <div className="rounded-2xl border border-white/20 bg-white/5 p-8 text-center">
                        <ClipboardList className="w-10 h-10 text-white/60 mx-auto mb-3" />
                        <p className="text-secondary-urban">No active delivery in progress.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg text-primary-urban">Completed Today</h3>
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-300/40">{completedTodayDeliveries.length} completed</span>
                  </div>
                  <div className="space-y-3">
                    {completedTodayDeliveries.map((delivery) => (
                      <div key={delivery.id} className="rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-500/10 to-emerald-700/10 p-4 shadow-xl">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-primary-urban font-medium">Order #{delivery.id.slice(0, 8)}</p>
                          <span className={`text-xs px-2 py-1 rounded-full capitalize ${getStatusBadgeClass(delivery.status)}`}>{delivery.status.replace('_', ' ')}</span>
                        </div>
                        <p className="text-xs text-muted-urban mt-1">Delivered at: {delivery.delivered_at ? new Date(delivery.delivered_at).toLocaleTimeString() : 'N/A'}</p>
                        <p className="text-xs text-muted-urban">Drop: {delivery.to_lat.toFixed(5)}, {delivery.to_lng.toFixed(5)}</p>
                      </div>
                    ))}
                    {completedTodayDeliveries.length === 0 && (
                      <div className="rounded-2xl border border-white/20 bg-white/5 p-8 text-center">
                        <ClipboardList className="w-10 h-10 text-white/60 mx-auto mb-3" />
                        <p className="text-secondary-urban">No completed deliveries for today.</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </GlassCard>
        )}

        {activeTab === 'navigate' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-2xl text-primary-urban">Live Navigation</h2>
              {activeDelivery && routeState && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-cyan-100 flex items-center gap-2"><Route className="w-4 h-4" />{routeState.distanceKm} km</span>
                  <span className="text-cyan-100 flex items-center gap-2"><Clock3 className="w-4 h-4" />ETA {routeState.etaMinutes} min</span>
                </div>
              )}
            </div>
            {!activeDelivery && <p className="text-secondary-urban">Accept and start a job to view route.</p>}
            {activeDelivery && (
              <>
                {routeWarning && <div className="mb-3 rounded-xl bg-yellow-500/80 text-white px-4 py-2">{routeWarning}</div>}
                <div className="h-[26rem] rounded-2xl overflow-hidden border border-white/20">
                  {isGoogleLoaded ? (
                    <GoogleMap mapContainerClassName="h-full w-full" center={{ lat: userLocation?.lat ?? activeDelivery.from_lat, lng: userLocation?.lng ?? activeDelivery.from_lng }} zoom={13} options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false, mapId: GOOGLE_MAP_ID || undefined }}>
                      {userLocation && <AdvancedMarker position={{ lat: userLocation.lat, lng: userLocation.lng }} label="U" title="Your live location" color="#22d3ee" enabled={Boolean(GOOGLE_MAP_ID)} />}
                      <AdvancedMarker position={{ lat: activeDelivery.from_lat, lng: activeDelivery.from_lng }} label="P" title="Pickup location" color="#6366f1" enabled={Boolean(GOOGLE_MAP_ID)} />
                      <AdvancedMarker position={{ lat: activeDelivery.to_lat, lng: activeDelivery.to_lng }} label="D" title="Delivery drop" color="#f97316" enabled={Boolean(GOOGLE_MAP_ID)} />
                      {routeState && <PolylineF path={routeState.polyline} options={{ strokeColor: routeState.source === 'ors' ? '#06b6d4' : '#f97316', strokeOpacity: 0.9, strokeWeight: 6, geodesic: true }} />}
                    </GoogleMap>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-white/70 bg-black/20">Loading map...</div>
                  )}
                </div>
                <div className="mt-3 grid sm:grid-cols-3 gap-3">
                  <div className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-secondary-urban">
                    Distance
                    <p className="text-primary-urban mt-1">{routeState ? `${routeState.distanceKm} km` : 'N/A'}</p>
                  </div>
                  <div className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-secondary-urban">
                    Duration
                    <p className="text-primary-urban mt-1">{routeState ? `${routeState.etaMinutes} min` : 'N/A'}</p>
                  </div>
                  <div className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-secondary-urban">
                    Last Update
                    <p className="text-primary-urban mt-1">{routeLoading ? 'Updating...' : routeState?.updatedAt ? new Date(routeState.updatedAt).toLocaleTimeString() : 'Pending'}</p>
                  </div>
                </div>
              </>
            )}
          </GlassCard>
        )}

        {activeTab === 'hub' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <h2 className="text-2xl text-primary-urban mb-4">Hub Actions</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-4">{HUBS.map((hub) => {
              const distanceKm = userLocation ? Math.round((haversineMeters(userLocation, { lat: hub.lat, lng: hub.lng }) / 1000) * 10) / 10 : null;
              return <div key={hub.id} className="rounded-xl border border-white/20 bg-white/5 p-4"><p className="text-primary-urban font-medium">{hub.name}</p><p className="text-xs text-muted-urban mt-1">{hub.lat.toFixed(4)}, {hub.lng.toFixed(4)}</p><p className="text-xs text-secondary-urban mt-1">{distanceKm !== null ? `${distanceKm} km away` : 'Distance unavailable'}</p></div>;
            })}</div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleHubAction('refuel')} className="px-4 py-2 rounded-xl bg-orange-500/35 hover:bg-orange-500/50 text-white flex items-center gap-2"><Fuel className="w-4 h-4" />Refuel</button>
              <button type="button" onClick={() => void handleHubAction('recharge')} className="px-4 py-2 rounded-xl bg-violet-500/35 hover:bg-violet-500/50 text-white flex items-center gap-2"><BatteryCharging className="w-4 h-4" />Recharge</button>
              <button type="button" onClick={() => void handleHubAction('arrive')} className="px-4 py-2 rounded-xl bg-cyan-500/35 hover:bg-cyan-500/50 text-white flex items-center gap-2"><MapPin className="w-4 h-4" />Mark Arrival at Hub</button>
            </div>
            {nearestHub && <p className="text-sm text-secondary-urban mt-3">Nearest hub: {nearestHub.hub.name} ({Math.round(nearestHub.distanceM)}m)</p>}
            {hubActionState && <p className="text-sm text-cyan-100 mt-2">{hubActionState}</p>}
          </GlassCard>
        )}

        {activeTab === 'pod' && <ProofOfDeliveryPanel deliveryId={pendingPodDeliveryId ?? activeDelivery?.id ?? null} expectedOtp={activeDelivery?.otp_code ?? null} onSuccess={handlePodSuccess} />}

        {activeTab === 'earnings' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <h2 className="text-2xl text-primary-urban mb-4">Earnings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl bg-emerald-500/20 border border-emerald-300/30 p-4"><p className="text-xs text-secondary-urban">Daily Total</p><p className="text-2xl text-white mt-1">Rs {earningsSummary.dailyTotal.toFixed(2)}</p></div>
              <div className="rounded-xl bg-indigo-500/20 border border-indigo-300/30 p-4"><p className="text-xs text-secondary-urban">Weekly Summary</p><p className="text-2xl text-white mt-1">Rs {earningsSummary.weeklyTotal.toFixed(2)}</p></div>
              <div className="rounded-xl bg-cyan-500/20 border border-cyan-300/30 p-4"><p className="text-xs text-secondary-urban">Avg per Delivery</p><p className="text-2xl text-white mt-1">Rs {earningsSummary.averagePerDelivery.toFixed(2)}</p></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="text-left border-b border-white/20 text-secondary-urban"><th className="py-2">Delivery</th><th className="py-2">Distance</th><th className="py-2">Rate</th><th className="py-2">Earning</th></tr></thead><tbody>{earningsSummary.entries.map((entry) => <tr key={entry.deliveryId} className="border-b border-white/10"><td className="py-2 text-primary-urban">#{entry.deliveryId.slice(0, 8)}</td><td className="py-2 text-secondary-urban">{entry.distanceKm.toFixed(1)} km</td><td className="py-2 text-secondary-urban">Rs {EARNING_RATE_PER_KM}/km</td><td className="py-2 text-emerald-100">Rs {entry.earning.toFixed(2)}</td></tr>)}</tbody></table>
              {earningsSummary.entries.length === 0 && <p className="text-secondary-urban py-4">No completed deliveries for earnings yet.</p>}
            </div>
          </GlassCard>
        )}

        {activeTab === 'vehicle' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <h2 className="text-2xl text-primary-urban mb-4">Vehicle Info</h2>
            {!vehicleInfo && <p className="text-secondary-urban mb-4">Live vehicle feed is syncing. Showing latest available telemetry.</p>}
            {vehicleInfo && (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Vehicle ID</p><p className="text-primary-urban mt-1">{vehicleInfo.id}</p></div>
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Max Capacity</p><p className="text-primary-urban mt-1">{vehicleInfo.maxCapacity}</p></div>
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Current Load</p><p className="text-primary-urban mt-1">{vehicleInfo.currentLoad}</p></div>
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Status</p><p className="text-primary-urban mt-1 capitalize">{vehicleInfo.status || 'idle'}</p></div>
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Fuel %</p><p className="text-primary-urban mt-1">{vehicleInfo.fuelPercent}%</p></div>
                  <div className="rounded-xl bg-white/5 border border-white/20 p-4"><p className="text-xs text-secondary-urban">Battery %</p><p className="text-primary-urban mt-1">{vehicleInfo.batteryPercent}%</p></div>
                </div>

              </>
            )}
            <div className="mt-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-300/30 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-secondary-urban">Battery Level</p>
                <p className="text-xl text-white font-semibold">{vehicleInfo?.batteryPercent ?? 0}%</p>
              </div>
              <div className="mt-3 h-4 rounded-full bg-white/10 border border-white/15 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${vehicleInfo && vehicleInfo.batteryPercent <= 20 ? 'bg-red-400' : vehicleInfo && vehicleInfo.batteryPercent <= 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ width: `${vehicleInfo?.batteryPercent ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-secondary-urban">
                {vehicleInfo
                  ? vehicleInfo.batteryPercent <= 20
                    ? 'Battery is low. Please plan charging soon.'
                    : 'Battery health is in a safe operating range.'
                  : 'Waiting for live battery telemetry from vehicle feed.'}
              </p>
            </div>

            <div className="mt-6">
              <h3 className="text-lg text-primary-urban mb-3">Nearby Charging Stations</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {nearbyChargingStations.map((station) => (
                  <div key={station.id} className="rounded-xl border border-white/20 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-primary-urban font-medium">{station.name}</p>
                        <p className="text-xs text-secondary-urban mt-1">
                          {station.distanceKm !== null ? `${station.distanceKm} km away` : 'Distance unavailable'}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${station.status === 'open' ? 'bg-emerald-500/20 text-emerald-100 border-emerald-300/40' : 'bg-amber-500/20 text-amber-100 border-amber-300/40'}`}>
                        {station.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-urban mt-2">Available Ports: {station.availablePorts}</p>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {activeTab === 'completed' && (
          <GlassCard className="rounded-2xl shadow-xl">
            <h2 className="text-2xl text-primary-urban mb-4">Completed Deliveries</h2>
            <div className="rounded-xl border border-white/20 bg-gradient-to-br from-indigo-500/15 to-cyan-500/10 p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-secondary-urban">Deliveries Trend (Last 7 Days)</p>
                <p className="text-xs text-secondary-urban">Today included</p>
              </div>
              <div
                ref={completedChartRef}
                className="h-44 touch-pan-x"
                onMouseMove={handleChartMouseMove}
                onMouseLeave={() => setChartFocusIndex(null)}
                onTouchMove={handleChartTouchMove}
                onTouchStart={handleChartTouchMove}
                onTouchEnd={() => setChartFocusIndex(null)}
              >
                <div className="h-full flex items-end gap-2">
                  {completedDeliveriesChart.points.map((point, index) => {
                    const heightPct = Math.max(8, Math.round((point.value / completedDeliveriesChart.max) * 100));
                    const isFocused =
                      chartFocusIndex !== null ? chartFocusIndex === index : index === completedDeliveriesChart.points.length - 1;
                    return (
                      <div key={point.key} className="flex-1 h-full flex flex-col items-center justify-end gap-2">
                        <div className={`text-xs transition ${isFocused ? 'text-cyan-50 scale-110' : 'text-cyan-100/80'}`}>{point.value}</div>
                        <div
                          className={`w-full rounded-t-md transition-all duration-300 ${isFocused ? 'bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.65)]' : 'bg-cyan-400/80 shadow-[0_0_16px_rgba(34,211,238,0.35)]'}`}
                          style={{ height: `${heightPct}%`, transform: isFocused ? 'scaleY(1.05)' : 'scaleY(1)' }}
                        />
                        <div className={`text-[11px] transition ${isFocused ? 'text-cyan-50' : 'text-secondary-urban'}`}>{point.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {completedDeliveries.map((delivery) => (
                <div key={delivery.id} className="rounded-xl border border-white/20 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-primary-urban">Order #{delivery.id.slice(0, 8)}</p><span className="text-xs rounded-full px-2 py-1 bg-emerald-500/20 text-emerald-100 border border-emerald-300/30">Delivered</span></div>
                  <p className="text-xs text-secondary-urban mt-1">Delivered At: {delivery.delivered_at ? new Date(delivery.delivered_at).toLocaleString() : 'N/A'}</p>
                  <p className="text-xs text-secondary-urban mt-1">Distance: {(delivery.route_distance_km ?? 0).toFixed(1)} km | Duration: {Math.round(delivery.route_duration_min ?? 0)} min</p>
                  {delivery.pod_image_url && <img src={delivery.pod_image_url} alt="POD" className="mt-3 h-24 w-24 rounded-lg object-cover border border-white/20" />}
                </div>
              ))}
              {completedDeliveries.length === 0 && <p className="text-secondary-urban py-4">No completed deliveries yet.</p>}
            </div>
          </GlassCard>
        )}
      </div>

      <button type="button" onClick={() => void handleEmergency()} disabled={isEmergencySending} className="fixed bottom-5 right-5 h-14 w-14 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white shadow-xl flex items-center justify-center z-50" title="Emergency Alert">
        {isEmergencySending ? <ShieldAlert className="w-6 h-6 animate-pulse" /> : <ShieldAlert className="w-6 h-6" />}
      </button>
    </div>
  );
}
