import { useCallback, useEffect, useMemo, useRef, useState } from 'react';import { useNavigate } from 'react-router-dom';import type { Session } from '@supabase/supabase-js';
import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';import { DashboardHeader } from './DashboardHeader';import { GlassCard } from './GlassCard';import { KPICard } from './KPICard';import { CO2Dashboard } from './CO2Dashboard';import { LoadConsolidationDashboard } from './LoadConsolidationDashboard';import { supabase } from '../../services/supabaseClient';import { hasVerifiedRole } from '../auth/fallbackAuth';import { AdvancedMarker } from './maps/AdvancedMarker';import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';import { AlertTriangle, ArrowRight, Clock, Package, Route, Truck, Users } from 'lucide-react';type DriverLive = {
  id: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  lastLat: number | null;
  lastLng: number | null;
  currentDeliveryId: string | null;
  updatedAt: string | null;
  vehicleId: string | null;
  battery: number | null;
  capacity?: number | null;
};

type DeliveryLive = {
  id: string;
  commodityName: string;
  quantity: number;
  status: string;
  driverId: string | null;
  eta: string | null;
  createdAt: string | null;
  priority?: string | null;
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
  utilizationPct: number;
  completionRatePct: number;
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

type DriverRow = {
  id: string;
  name: string | null;
  status: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  last_lat: number | null;
  last_lng: number | null;
  current_delivery_id?: string | null;
  last_location_updated_at?: string | null;
  updated_at?: string | null;
};

type VehicleRow = {
  id: string;
  driver_name: string | null;
  capacity: number | null;
  status: string | null;
};

type VehicleStatusRow = {
  vehicle_id: string;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
  battery_level: number | null;
  updated_at?: string | null;
};

type DeliveryRow = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: string | null;
  priority: string | null;
  from_lat: number | null;
  from_lng: number | null;
  to_lat: number | null;
  to_lng: number | null;
  created_at?: string | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
};


const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
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

const realtimeStatuses = new Set(['assigned', 'accepted', 'in_transit']);

const mapDriverLive = (
  row: DriverRow,
  vehicleByDriverName: Map<string, VehicleRow>,
  statusByVehicleId: Map<string, VehicleStatusRow>
): DriverLive | null => {
  const normalizedStatus = (row.status || '').toLowerCase().replace('-', '_');
  const liveLat = toNumber(row.current_latitude);
  const liveLng = toNumber(row.current_longitude);
  const lastLat = toNumber(row.last_lat);
  const lastLng = toNumber(row.last_lng);
  const lat = normalizedStatus === 'at_hub' ? lastLat ?? liveLat : liveLat ?? lastLat;
  const lng = normalizedStatus === 'at_hub' ? lastLng ?? liveLng : liveLng ?? lastLng;
  if (lat === null || lng === null) return null;
  const driverName = row.name || 'Unknown Driver';
  const vehicle = vehicleByDriverName.get(driverName) || null;
  const vehicleStatus = vehicle ? statusByVehicleId.get(vehicle.id) || null : null;
  return {
    id: row.id,
    name: driverName,
    status: normalizedStatus || (vehicleStatus?.status || 'unknown').toLowerCase().replace('-', '_'),
    lat,
    lng,
    lastLat,
    lastLng,
    currentDeliveryId: row.current_delivery_id ?? null,
    updatedAt: row.last_location_updated_at ?? row.updated_at ?? null,
    vehicleId: vehicle?.id || null,
    battery: vehicleStatus?.battery_level ?? null,
    capacity: vehicle?.capacity ?? null,
  };
};

const mapDeliveryLive = (row: DeliveryRow): DeliveryLive => {
  const createdAt = row.created_at ?? null;
  const eta = createdAt ? new Date(new Date(createdAt).getTime() + 30 * 60000).toISOString() : null;
  return {
  id: row.id,
  commodityName: row.priority ? `${row.priority} priority` : 'Delivery',
  quantity: 1,
  status: (row.status || 'assigned').toLowerCase(),
  driverId: row.driver_id,
  eta,
  createdAt,
  priority: row.priority ?? null,
  pickupLat: toNumber(row.from_lat),
  pickupLng: toNumber(row.from_lng),
  dropLat: toNumber(row.to_lat),
  dropLng: toNumber(row.to_lng),
  };
};

export function LogisticsOperatorDashboard() {
  const googleMapsApiKey = GOOGLE_MAPS_API_KEY;
  const allowGuest = import.meta.env.VITE_ALLOW_GUEST_DASHBOARD === 'true' || import.meta.env.DEV;
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps',
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
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
  const [selectedDriver, setSelectedDriver] = useState<DriverLive | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    coordinates: [number, number][];
    distance: number;
    duration: number;
    source: 'road' | 'fallback';
  } | null>(null);
  const [routeWarning, setRouteWarning] = useState<string | null>(null);
  const [kpiUpdatedAt, setKpiUpdatedAt] = useState<{ deliveries?: string; drivers?: string; alerts?: string }>({});
  const [realtimeStatus, setRealtimeStatus] = useState<{ drivers: string; vehicle: string; deliveries: string }>({
    drivers: 'INIT',
    vehicle: 'INIT',
    deliveries: 'INIT',
  });
  const [flashDeliveries, setFlashDeliveries] = useState(false);
  const [flashDrivers, setFlashDrivers] = useState(false);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, { lat: number; lng: number }>>({});
  const prevCountsRef = useRef<{ deliveries: number; activeDrivers: number }>({ deliveries: 0, activeDrivers: 0 });
  const animatedPositionsRef = useRef<Record<string, { lat: number; lng: number }>>({});
  const animationRef = useRef<number | null>(null);
  const vehicleByDriverNameRef = useRef<Map<string, VehicleRow>>(new Map());
  const statusByVehicleIdRef = useRef<Map<string, VehicleStatusRow>>(new Map());
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const getSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        if (isMounted.current) {
          setError(sessionError.message);
          setCheckingAuth(false);
        }
        return;
      }
      if (!data.session) {
        const hasFallbackAccess = hasVerifiedRole('logistics-operator');
        if (!hasFallbackAccess && !allowGuest) {
          navigate('/login/logistics-operator', { replace: true });
          return;
        }
        if (isMounted.current) {
          setFallbackAuthorized(true);
          setCheckingAuth(false);
        }
        return;
      }
      if (isMounted.current) {
        setFallbackAuthorized(false);
        setSession(data.session);
        setCheckingAuth(false);
      }
    };

    void getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        if (!hasVerifiedRole('logistics-operator') && !allowGuest) {
          navigate('/login/logistics-operator', { replace: true });
          return;
        }
        if (isMounted.current) {
          setFallbackAuthorized(true);
        }
        return;
      }
      if (isMounted.current) {
        setFallbackAuthorized(false);
        setSession(newSession);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [navigate, allowGuest, hasVerifiedRole]);

  const hydrateDashboard = useCallback(async () => {
    try {
      setError(null);

      const [driverRes, vehicleRes, vehicleStatusRes, deliveryRes] = await Promise.all([
        supabase.from('drivers').select('*'),
        supabase.from('vehicles').select('*'),
        supabase.from('vehicle_status').select('*'),
        supabase.from('deliveries').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      if (driverRes.error) throw new Error(driverRes.error.message);
      if (vehicleRes.error) throw new Error(vehicleRes.error.message);
      if (vehicleStatusRes.error) throw new Error(vehicleStatusRes.error.message);
      if (deliveryRes.error) throw new Error(deliveryRes.error.message);

      const vehicles = (vehicleRes.data || []) as VehicleRow[];
      const vehicleStatusRows = (vehicleStatusRes.data || []) as VehicleStatusRow[];
      const vehicleByDriverName = new Map<string, VehicleRow>();
      vehicles.forEach((v) => {
        if (v.driver_name) vehicleByDriverName.set(v.driver_name, v);
      });
      const statusByVehicleId = new Map<string, VehicleStatusRow>();
      vehicleStatusRows.forEach((s) => {
        if (s.vehicle_id) statusByVehicleId.set(s.vehicle_id, s);
      });

      vehicleByDriverNameRef.current = vehicleByDriverName;
      statusByVehicleIdRef.current = statusByVehicleId;

      const mappedDrivers = ((driverRes.data || []) as DriverRow[])
        .map((row) => mapDriverLive(row, vehicleByDriverName, statusByVehicleId))
        .filter((driver): driver is DriverLive => driver !== null);

      const mappedDeliveries = ((deliveryRes.data || []) as DeliveryRow[]).map((row) => mapDeliveryLive(row));

      if (isMounted.current) {
        setDrivers(mappedDrivers);
        setDeliveries(mappedDeliveries);
        const nowIso = new Date().toISOString();
        setLastUpdated(nowIso);
        setKpiUpdatedAt({ deliveries: nowIso, drivers: nowIso, alerts: nowIso });
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      }
    } finally {
      if (isMounted.current) {
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!session && !fallbackAuthorized) return;

    void hydrateDashboard();

    const driversChannel = supabase
      .channel('admin-drivers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, (payload) => {
        const nextRow = (payload.new || payload.old) as DriverRow;
        const rowId = nextRow?.id;
        const mapped =
          rowId
            ? mapDriverLive(nextRow, vehicleByDriverNameRef.current, statusByVehicleIdRef.current)
            : null;
        if (!rowId) return;

        if (payload.eventType === 'DELETE') {
          setDrivers((prev) => prev.filter((driver) => driver.id !== rowId));
          return;
        }

        if (!mapped) return;
        setDrivers((prev) => {
          const exists = prev.some((driver) => driver.id === mapped.id);
          if (!exists) return [mapped, ...prev];
          return prev.map((driver) => (driver.id === mapped.id ? mapped : driver));
        });
        setKpiUpdatedAt((prev) => ({ ...prev, drivers: new Date().toISOString() }));
      })
      .subscribe((status) => {
        setRealtimeStatus((prev) => ({ ...prev, drivers: status }));
      });

    const vehicleStatusChannel = supabase
      .channel('admin-vehicle-status-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_status' }, (payload) => {
        const nextRow = (payload.new || payload.old) as VehicleStatusRow;
        const vehicleId = nextRow?.vehicle_id;
        if (!vehicleId) return;
        const lat = toNumber(nextRow.latitude);
        const lng = toNumber(nextRow.longitude);
        const battery = toNumber(nextRow.battery_level);
        const status = (nextRow.status || 'unknown').toLowerCase().replace('-', '_');
        const updatedAt = nextRow.updated_at ?? null;

        statusByVehicleIdRef.current.set(vehicleId, nextRow);

        setDrivers((prev) =>
          prev.map((driver) => {
            if (driver.vehicleId !== vehicleId) return driver;
            const shouldOverrideLocation = driver.status !== 'in_transit' && driver.status !== 'at_hub';
            return {
              ...driver,
              lat: shouldOverrideLocation ? lat ?? driver.lat : driver.lat,
              lng: shouldOverrideLocation ? lng ?? driver.lng : driver.lng,
              battery: battery ?? driver.battery,
              status: status || driver.status,
              updatedAt: updatedAt ?? driver.updatedAt,
            };
          })
        );
        setKpiUpdatedAt((prev) => ({ ...prev, drivers: new Date().toISOString() }));
      })
      .subscribe((status) => {
        setRealtimeStatus((prev) => ({ ...prev, vehicle: status }));
      });

    const deliveriesChannel = supabase
      .channel('admin-deliveries-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, (payload) => {
        const nextRow = (payload.new || payload.old) as DeliveryRow;
        const rowId = nextRow?.id;
        if (!rowId) return;

        if (payload.eventType === 'DELETE') {
          setDeliveries((prev) => prev.filter((delivery) => delivery.id !== rowId));
          return;
        }

        const mapped = mapDeliveryLive(nextRow);
        setDeliveries((prev) => {
          const exists = prev.some((delivery) => delivery.id === mapped.id);
          if (!exists) return [mapped, ...prev].slice(0, 200);
          return prev.map((delivery) => (delivery.id === mapped.id ? mapped : delivery));
        });
        const nowIso = new Date().toISOString();
        setLastUpdated(nowIso);
        setKpiUpdatedAt((prev) => ({ ...prev, deliveries: nowIso }));
      })
      .subscribe((status) => {
        setRealtimeStatus((prev) => ({ ...prev, deliveries: status }));
      });

    return () => {
      supabase.removeChannel(driversChannel);
      supabase.removeChannel(vehicleStatusChannel);
      supabase.removeChannel(deliveriesChannel);
    };
  }, [session, fallbackAuthorized, hydrateDashboard]);

  useEffect(() => {
    if (drivers.length === 0) return;
    const targets = drivers.reduce((acc, driver) => {
      acc[driver.id] = { lat: driver.lat, lng: driver.lng };
      return acc;
    }, {} as Record<string, { lat: number; lng: number }>);
    const starts = { ...animatedPositionsRef.current };
    drivers.forEach((driver) => {
      if (!starts[driver.id]) {
        starts[driver.id] = { lat: driver.lat, lng: driver.lng };
      }
    });
    const startTime = performance.now();
    const duration = 600;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const nextPositions: Record<string, { lat: number; lng: number }> = {};
      Object.keys(targets).forEach((id) => {
        const start = starts[id];
        const end = targets[id];
        nextPositions[id] = {
          lat: start.lat + (end.lat - start.lat) * progress,
          lng: start.lng + (end.lng - start.lng) * progress,
        };
      });
      animatedPositionsRef.current = nextPositions;
      setAnimatedPositions(nextPositions);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step);
      }
    };

    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = requestAnimationFrame(step);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drivers]);

  const kpi = useMemo<KPIState>(() => {
    const now = Date.now();
    const delivered = deliveries.filter((d) => d.status === 'completed');
    const delayed = deliveries.filter((d) => {
      if (!d.eta) return false;
      if (d.status === 'completed') return false;
      const etaMs = new Date(d.eta).getTime();
      return Number.isFinite(etaMs) && etaMs < now;
    });
    const onTimeDelivered = delivered.filter((d) => {
      if (!d.eta || !d.createdAt) return false;
      return new Date(d.createdAt).getTime() <= new Date(d.eta).getTime();
    }).length;
    const activeDrivers = drivers.filter((d) => realtimeStatuses.has(d.status)).length;
    const vehicleLoadMap = deliveries.reduce((acc, d) => {
      if (d.status === 'completed') return acc;
      if (!d.driverId) return acc;
      acc[d.driverId] = (acc[d.driverId] || 0) + (d.quantity || 0);
      return acc;
    }, {} as Record<string, number>);
    const totalCapacity = drivers.reduce((sum, d) => sum + (d.capacity || 0), 0);
    const usedCapacity = drivers.reduce((sum, d) => sum + (vehicleLoadMap[d.id] || 0), 0);
    const utilizationPct = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;
    const completionRatePct =
      deliveries.length > 0 ? Math.round((delivered.length / deliveries.length) * 100) : 0;

    return {
      totalDeliveries: deliveries.length,
      activeDeliveries: deliveries.filter((d) => realtimeStatuses.has(d.status)).length,
      completedDeliveries: delivered.length,
      delayedDeliveries: delayed.length,
      onTimePct: delivered.length > 0 ? Math.round((onTimeDelivered / delivered.length) * 100) : 0,
      activeDrivers,
      alerts: alerts.length,
      utilizationPct,
      completionRatePct,
    };
  }, [deliveries, drivers, alerts.length]);

  const delayedIds = useMemo(() => {
    const now = Date.now();
    return new Set(
      deliveries
        .filter((d) => {
          if (!d.eta) return false;
          if (d.status === 'completed') return false;
          const etaMs = new Date(d.eta).getTime();
          return Number.isFinite(etaMs) && etaMs < now;
        })
        .map((d) => d.id)
    );
  }, [deliveries]);

  const handleDriverSelect = useCallback(
    async (driver: DriverLive) => {
      setSelectedDriver(driver);
      setSelectedDestination(null);
      setRouteWarning(null);
      setRouteInfo(null);

      if (driver.status !== 'in_transit') {
        setRouteWarning('Driver is not in transit.');
        return;
      }

      if (!driver.currentDeliveryId) {
        setRouteWarning('No active delivery linked to this driver.');
        return;
      }

      const { data, error: deliveryError } = await supabase
        .from('deliveries')
        .select('id,to_lat,to_lng,drop_lat,drop_lng,status')
        .eq('id', driver.currentDeliveryId)
        .maybeSingle();

      if (deliveryError || !data) {
        setRouteWarning('Unable to load delivery details.');
        return;
      }

      const destLat = toNumber(data.to_lat ?? data.drop_lat);
      const destLng = toNumber(data.to_lng ?? data.drop_lng);
      if (destLat === null || destLng === null) {
        setRouteWarning('Delivery destination missing coordinates.');
        return;
      }

      const start: [number, number] = [driver.lat, driver.lng];
      const end: [number, number] = [destLat, destLng];
      setSelectedDestination({ lat: destLat, lng: destLng });
      const roadRoute = await fetchRoadRoute(start, end);
      if (roadRoute) {
        setRouteInfo(roadRoute);
        return;
      }

      setRouteWarning('Using fallback straight-line route (ORS unavailable).');
      setRouteInfo(buildFallbackRoute(start, end));
    },
    []
  );

  useEffect(() => {
    const prev = prevCountsRef.current;
    if (kpi.totalDeliveries > prev.deliveries) {
      setFlashDeliveries(true);
      setTimeout(() => setFlashDeliveries(false), 800);
    }
    if (kpi.activeDrivers > prev.activeDrivers) {
      setFlashDrivers(true);
      setTimeout(() => setFlashDrivers(false), 800);
    }
    prevCountsRef.current = { deliveries: kpi.totalDeliveries, activeDrivers: kpi.activeDrivers };
  }, [kpi.totalDeliveries, kpi.activeDrivers]);

  const activeDriverPins = useMemo(() => {
    return drivers.filter((d) => d.status === 'in_transit');
  }, [drivers]);

  const atHubDriverPins = useMemo(() => {
    return drivers.filter((d) => d.status === 'at_hub' && d.lastLat !== null && d.lastLng !== null);
  }, [drivers]);

  const lastLocationPins = useMemo(() => {
    return drivers.filter((d) => d.lastLat !== null && d.lastLng !== null && d.status !== 'at_hub');
  }, [drivers]);

  const mapCenter = { lat: 13.174391, lng: 80.09761 };

  const realtimeConnected = useMemo(() => {
    return [realtimeStatus.drivers, realtimeStatus.vehicle, realtimeStatus.deliveries].every(
      (status) => status === 'SUBSCRIBED'
    );
  }, [realtimeStatus]);

  const insight = useMemo(() => {
    const highPriorityPending = deliveries.filter(
      (d) => d.status === 'assigned' && (d.priority || '').toLowerCase() === 'high'
    ).length;
    const idleDrivers = drivers.filter((d) => d.status === 'idle').length;
    if (highPriorityPending > 0 && idleDrivers > 0) {
      return `${highPriorityPending} high-priority deliveries awaiting assignment with ${idleDrivers} idle drivers.`;
    }
    if (highPriorityPending > 0) {
      return `${highPriorityPending} high-priority deliveries are waiting for assignment.`;
    }
    if (idleDrivers > 0) {
      return `${idleDrivers} idle drivers available for new assignments.`;
    }
    return 'System balanced. No immediate bottlenecks detected.';
  }, [deliveries, drivers]);

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
    setKpiUpdatedAt((prev) => ({ ...prev, alerts: new Date().toISOString() }));
  }, [drivers, deliveries]);

  const suggestions = useMemo<RouteSuggestion[]>(() => {
    const idleDrivers = drivers.filter((d) => d.status === 'idle');
    const pendingDeliveries = deliveries.filter(
      (d) =>
        d.status === 'assigned' &&
        d.pickupLat !== null &&
        d.pickupLng !== null
    );
    if (idleDrivers.length === 0) return [];
    const pendingDelivery = pendingDeliveries[0];
    if (!pendingDelivery) return [];
    const best = idleDrivers.reduce(
      (nearest, driver) => {
        const distance = getDistanceKm(
          driver.lat,
          driver.lng,
          pendingDelivery.pickupLat as number,
          pendingDelivery.pickupLng as number
        );
        if (!nearest || distance < nearest.distance) {
          return { driver, distance };
        }
        return nearest;
      },
      null as { driver: DriverLive; distance: number } | null
    );
    if (!best) return [];
    return [
      {
        deliveryId: pendingDelivery.id,
        driverName: best.driver.name,
        distanceKm: Math.round(best.distance * 10) / 10,
      },
    ];
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
        <div className="flex justify-end mb-3">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              realtimeConnected ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'
            }`}
          >
            {realtimeConnected ? 'Realtime Connected' : 'Realtime Disconnected'}
          </span>
        </div>

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
          <div className={flashDeliveries ? 'ring-2 ring-emerald-400/60 rounded-3xl' : ''}>
            <KPICard
              icon={Package}
              label="Total Deliveries"
              value={kpi.totalDeliveries}
              change={kpiUpdatedAt.deliveries ? `Updated ${new Date(kpiUpdatedAt.deliveries).toLocaleTimeString()}` : undefined}
            />
          </div>
          <KPICard
            icon={Truck}
            label="Active Deliveries"
            value={kpi.activeDeliveries}
            change={kpiUpdatedAt.deliveries ? `Updated ${new Date(kpiUpdatedAt.deliveries).toLocaleTimeString()}` : undefined}
          />
          <KPICard
            icon={Clock}
            label="Delayed Deliveries"
            value={kpi.delayedDeliveries}
            change={kpiUpdatedAt.deliveries ? `Updated ${new Date(kpiUpdatedAt.deliveries).toLocaleTimeString()}` : undefined}
          />
          <div className={flashDrivers ? 'ring-2 ring-emerald-400/60 rounded-3xl' : ''}>
            <KPICard
              icon={Users}
              label="Active Drivers"
              value={kpi.activeDrivers}
              change={kpiUpdatedAt.drivers ? `Updated ${new Date(kpiUpdatedAt.drivers).toLocaleTimeString()}` : undefined}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <KPICard
            icon={Route}
            label="Fleet Utilization"
            value={`${kpi.utilizationPct}%`}
            change={kpiUpdatedAt.deliveries ? `Updated ${new Date(kpiUpdatedAt.deliveries).toLocaleTimeString()}` : undefined}
          />
          <KPICard
            icon={Package}
            label="Completion Rate"
            value={`${kpi.completionRatePct}%`}
            change={kpiUpdatedAt.deliveries ? `Updated ${new Date(kpiUpdatedAt.deliveries).toLocaleTimeString()}` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <GlassCard className="lg:col-span-2">
            <h2 className="text-lg text-primary-urban mb-3">Live Driver Map</h2>
            <div className="h-[500px] w-full rounded-xl overflow-hidden">
              {isGoogleLoaded ? (
                <GoogleMap
                  mapContainerClassName="h-full w-full"
                  center={mapCenter}
                  zoom={15}
                  options={{
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    mapId: GOOGLE_MAP_ID || undefined,
                  }}
                >
                  {routeInfo && (
                    <Polyline
                      path={routeInfo.coordinates.map(([lat, lng]) => ({ lat, lng }))}
                      options={{
                        strokeColor: routeInfo.source === 'road' ? '#22d3ee' : '#f97316',
                        strokeOpacity: 0.85,
                        strokeWeight: 4,
                      }}
                    />
                  )}
                  {selectedDestination && (
                    <AdvancedMarker
                      key="selected-destination"
                      position={selectedDestination}
                      title="Delivery destination"
                      color="#f97316"
                      size={12}
                      enabled={Boolean(GOOGLE_MAP_ID)}
                    />
                  )}
                  <Marker
                    key="force-visible-pin"
                    position={{ lat: 13.174391, lng: 80.09761 }}
                    title="FORCED PIN"
                  />
                  {activeDriverPins.map((driver) => {
                    const markerPos = animatedPositions[driver.id] ?? { lat: driver.lat, lng: driver.lng };
                    return (
                      <AdvancedMarker
                        key={driver.id}
                        position={markerPos}
                        title={`${driver.name} | ${driver.status} | Battery: ${driver.battery ?? 'N/A'}%`}
                        color={
                          driver.battery !== null && driver.battery < 10
                            ? '#ef4444'
                            : driver.battery !== null && driver.battery < 20
                            ? '#f97316'
                            : '#22d3ee'
                        }
                        size={driver.battery !== null && driver.battery < 10 ? 16 : 14}
                        pulse={driver.battery !== null && driver.battery < 10}
                        enabled={Boolean(GOOGLE_MAP_ID)}
                        onClick={() => handleDriverSelect(driver)}
                      />
                    );
                  })}
                  {atHubDriverPins.map((driver) => (
                    <AdvancedMarker
                      key={`hub-${driver.id}`}
                      position={{ lat: driver.lastLat ?? driver.lat, lng: driver.lastLng ?? driver.lng }}
                      title={`${driver.name} | at-hub`}
                      color="#a855f7"
                      size={13}
                      enabled={Boolean(GOOGLE_MAP_ID)}
                      onClick={() => handleDriverSelect(driver)}
                    />
                  ))}
                  {lastLocationPins.map((driver) => (
                    <AdvancedMarker
                      key={`last-${driver.id}`}
                      position={{ lat: driver.lastLat ?? driver.lat, lng: driver.lastLng ?? driver.lng }}
                      title={`${driver.name} | last known location`}
                      color="#94a3b8"
                      size={10}
                      enabled={Boolean(GOOGLE_MAP_ID)}
                      onClick={() => handleDriverSelect(driver)}
                    />
                  ))}
                </GoogleMap>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-white/70 bg-black/20">
                  Loading Google Map...
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-urban">
              {activeDriverPins.slice(0, 4).map((driver) => (
                <div key={driver.id} className="flex items-center justify-between">
                  <span className="text-secondary-urban">{driver.name}</span>
                  <span>{driver.updatedAt ? new Date(driver.updatedAt).toLocaleTimeString() : 'Last update: N/A'}</span>
                </div>
              ))}
            </div>
            {selectedDriver && (
              <div className="mt-3 rounded-xl bg-white/5 p-3 text-sm text-secondary-urban">
                <p className="text-primary-urban">{selectedDriver.name} route preview</p>
                {routeInfo && (
                  <p className="mt-1">
                    Distance: {routeInfo.distance} km · ETA: {routeInfo.duration} min
                  </p>
                )}
                {routeWarning && <p className="mt-1 text-yellow-300">{routeWarning}</p>}
              </div>
            )}
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
                    <tr
                      key={delivery.id}
                      className={`border-b border-white/5 ${delayedIds.has(delivery.id) ? 'animate-pulse bg-red-500/10' : ''}`}
                    >
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
                  No assigned deliveries with idle drivers right now.
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
              On-time: {kpi.onTimePct}% - Completed: {kpi.completedDeliveries} - Alerts: {kpi.alerts}
            </div>
          </GlassCard>
        </div>

        <GlassCard className="mb-6">
          <h2 className="text-lg text-primary-urban mb-2">Insight</h2>
          <p className="text-secondary-urban text-sm">{insight}</p>
        </GlassCard>

        <LoadConsolidationDashboard />
        <CO2Dashboard />
      </div>
    </div>
  );
}
