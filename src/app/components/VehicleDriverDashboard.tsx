import { useCallback, useEffect, useMemo, useRef, useState } from 'react';import { useNavigate, useParams } from 'react-router-dom';import type { Session } from '@supabase/supabase-js';
import { GoogleMap, PolylineF, useJsApiLoader } from '@react-google-maps/api';import { DashboardHeader } from './DashboardHeader';import { GlassCard } from './GlassCard';import { KPICard } from './KPICard';import { supabase } from '../../services/supabaseClient';import { hasVerifiedRole } from '../auth/fallbackAuth';import { AdvancedMarker } from './maps/AdvancedMarker';import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';import { Package, Navigation, MapPin, Clock, CheckCircle } from 'lucide-react';const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || '';
const ACTIVE_STATUSES = ['assigned', 'accepted', 'in_transit'] as const;
type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
const isActiveStatus = (status: Delivery['status']): status is ActiveStatus =>
  (ACTIVE_STATUSES as readonly Delivery['status'][]).includes(status);

type Delivery = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: 'assigned' | 'accepted' | 'in_transit' | 'completed' | 'rejected' | 'cancelled';
  priority: string | null;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
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
};

type RouteInfo = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  source: 'road' | 'fallback';
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeDelivery = (row: DeliveryRow): Delivery => {
  const statusRaw = (row.status || 'assigned').toLowerCase();
  const status =
    statusRaw === 'assigned' ||
    statusRaw === 'accepted' ||
    statusRaw === 'in_transit' ||
    statusRaw === 'completed' ||
    statusRaw === 'rejected' ||
    statusRaw === 'cancelled'
      ? (statusRaw as Delivery['status'])
      : 'assigned';

  return {
    id: row.id,
    driver_id: row.driver_id,
    vehicle_id: row.vehicle_id,
    status,
    priority: row.priority ?? null,
    from_lat: toNumber(row.from_lat) ?? 0,
    from_lng: toNumber(row.from_lng) ?? 0,
    to_lat: toNumber(row.to_lat) ?? 0,
    to_lng: toNumber(row.to_lng) ?? 0,
  };
};

const isValidCoord = (value: number) => Number.isFinite(value);

const fetchRoadRoute = async (start: [number, number], end: [number, number]): Promise<RouteInfo | null> => {
  if (!ORS_API_KEY) return null;

  try {
    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}&format=geojson`
    );

    if (!response.ok) throw new Error('Failed to fetch route');
    const data = await response.json();

    if (!data?.features?.length || !data.features[0]?.geometry?.coordinates?.length) return null;

    const coordinates = data.features[0].geometry.coordinates.map(
      (coord: number[]) => [coord[1], coord[0]] as [number, number]
    );
    const segment = data.features[0]?.properties?.segments?.[0];
    const distance = Number(segment?.distance || 0) / 1000;
    const duration = Number(segment?.duration || 0) / 60;

    return {
      coordinates,
      distance: Math.round(distance * 10) / 10,
      duration: Math.max(1, Math.round(duration)),
      source: 'road',
    };
  } catch {
    return null;
  }
};

const buildFallbackRoute = (start: [number, number], end: [number, number]): RouteInfo => {
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]) * 111;
  return {
    coordinates: [start, end],
    distance: Math.round(distance * 10) / 10,
    duration: Math.max(1, Math.round(distance * 3)),
    source: 'fallback',
  };
};

export function VehicleDriverDashboard() {
  const googleMapsApiKey = GOOGLE_MAPS_API_KEY;
  const allowGuest = import.meta.env.VITE_ALLOW_GUEST_DASHBOARD === 'true' || import.meta.env.DEV;
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps',
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
  });

  const navigate = useNavigate();
  const { vehicleId } = useParams<{ vehicleId?: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [fallbackAuthorized, setFallbackAuthorized] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [activeTab, setActiveTab] = useState<'jobs' | 'navigation'>('jobs');
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeWarning, setRouteWarning] = useState<string | null>(null);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingDriver, setResolvingDriver] = useState(true);

  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const routeUpdateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const activeDelivery = useMemo(() => {
    return deliveries.find((d) => d.status === 'accepted' || d.status === 'in_transit') || null;
  }, [deliveries]);

  const visibleDeliveries = useMemo(() => {
    return deliveries.filter((d) => isActiveStatus(d.status));
  }, [deliveries]);

  useEffect(() => {
    locationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const hasFallback = hasVerifiedRole('vehicle-driver');
        if (!hasFallback && !allowGuest) {
          navigate('/login/vehicle-driver');
          return;
        }
        if (isMounted.current) {
          setFallbackAuthorized(true);
          setSession(null);
          setLoading(false);
        }
        return;
      }
      if (isMounted.current) {
        setFallbackAuthorized(false);
        setSession(data.session);
        setLoading(false);
      }
    };

    void loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (isMounted.current) {
        setSession(newSession);
      }
      if (!newSession) {
        if (allowGuest || hasVerifiedRole('vehicle-driver')) {
          if (isMounted.current) setFallbackAuthorized(true);
          return;
        }
        navigate('/login/vehicle-driver');
      } else {
        if (isMounted.current) setFallbackAuthorized(false);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [allowGuest, navigate, hasVerifiedRole]);

  useEffect(() => {
    const resolveDriver = async () => {
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
      const { data, error } = await supabase.from('drivers').select('id').limit(1);
      if (!error && data && data[0]?.id) {
        setDriverId(data[0].id);
        setResolvingDriver(false);
        return;
      }
      setResolvingDriver(false);
      if (!fallbackAuthorized && !allowGuest) {
        navigate('/login/vehicle-driver');
      }
    };

    void resolveDriver();
  }, [vehicleId, session, navigate, fallbackAuthorized, allowGuest]);

  useEffect(() => {
    if (!driverId) return;

    const fetchInitial = async () => {
      const { data, error } = await supabase
        .from('deliveries')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false });

      if (error) {
        if (isMounted.current) setUiError('Failed to load deliveries.');
        return;
      }

      const normalized = ((data || []) as DeliveryRow[]).map(normalizeDelivery);
      if (isMounted.current) setDeliveries(normalized);
    };

    void fetchInitial();

    const deliveriesChannel = supabase
      .channel('driver-deliveries-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `driver_id=eq.${driverId}` },
        (payload) => {
          const row = normalizeDelivery(payload.new as DeliveryRow);
          if (!isActiveStatus(row.status)) return;
          setDeliveries((prev) => (prev.some((d) => d.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'deliveries', filter: `driver_id=eq.${driverId}` },
        (payload) => {
          const row = normalizeDelivery(payload.new as DeliveryRow);
          if (!isActiveStatus(row.status)) {
            setDeliveries((prev) => prev.filter((d) => d.id !== row.id));
            return;
          }
          setDeliveries((prev) => {
            const exists = prev.some((d) => d.id === row.id);
            if (!exists) return [row, ...prev];
            return prev.map((d) => (d.id === row.id ? row : d));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(deliveriesChannel);
    };
  }, [driverId]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (isMounted.current) setUserLocation(next);
        if (isMounted.current) setLocationError(null);
      },
      (err) => {
        if (isMounted.current) setLocationError(`Location error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const requestRoute = useCallback(async (delivery: Delivery) => {
    const loc = locationRef.current;
    if (!loc) {
      setRouteWarning('Live location unavailable.');
      return;
    }

    if (!isValidCoord(delivery.to_lat) || !isValidCoord(delivery.to_lng)) {
      setRouteWarning('Invalid delivery coordinates.');
      return;
    }

    if (!isMounted.current) return;
    setIsRouteLoading(true);
    setRouteWarning(null);
    const start: [number, number] = [loc.lat, loc.lng];
    const end: [number, number] = [delivery.to_lat, delivery.to_lng];

    const route = await fetchRoadRoute(start, end);
    if (route) {
      if (isMounted.current) setRouteInfo(route);
    } else {
      if (isMounted.current) {
        setRouteInfo(buildFallbackRoute(start, end));
        setRouteWarning('Road route unavailable. Showing straight-line fallback.');
      }
    }
    if (isMounted.current) setIsRouteLoading(false);
  }, []);

  useEffect(() => {
    if (!activeDelivery) {
      setRouteInfo(null);
      return;
    }

    if (activeTab !== 'navigation') return;

    if (routeUpdateTimeout.current) {
      clearTimeout(routeUpdateTimeout.current);
    }

    routeUpdateTimeout.current = setTimeout(() => {
      void requestRoute(activeDelivery);
    }, 300);

    return () => {
      if (routeUpdateTimeout.current) {
        clearTimeout(routeUpdateTimeout.current);
      }
    };
  }, [activeDelivery, activeTab, requestRoute]);

  const handleAccept = async (deliveryId: string) => {
    setUiError(null);
    if (!driverId) return;
    if (activeDelivery && activeDelivery.id !== deliveryId) {
      setUiError('You already have an active delivery. Complete it first.');
      return;
    }

    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'accepted' })
      .eq('id', deliveryId)
      .eq('status', 'assigned');

    if (error) {
      setUiError('Job already taken.');
    }
  };

  const handleReject = async (deliveryId: string) => {
    setUiError(null);
    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'rejected' })
      .eq('id', deliveryId)
      .eq('status', 'assigned');

    if (error) {
      setUiError('Unable to reject this job.');
    }
  };

  const handleNavigate = (delivery: Delivery) => {
    setActiveTab('navigation');
    void requestRoute(delivery);
  };

  const handleStartTrip = async (delivery: Delivery) => {
    setUiError(null);
    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'in_transit' })
      .eq('id', delivery.id)
      .eq('status', 'accepted');

    if (error) {
      setUiError('Unable to start trip.');
      return;
    }

    setActiveTab('navigation');
    void requestRoute(delivery);
  };

  const handleMarkDelivered = async (deliveryId: string) => {
    setUiError(null);
    const { error } = await supabase
      .from('deliveries')
      .update({ status: 'completed' })
      .eq('id', deliveryId)
      .eq('status', 'in_transit');

    if (error) {
      setUiError('Unable to mark delivery complete.');
    }
  };

  if (loading || resolvingDriver) {
    return (
      <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center">
        <p className="text-white text-xl">Loading dashboard...</p>
      </div>
    );
  }

  if (!session && !fallbackAuthorized && !allowGuest) {
    return (
      <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center">
        <p className="text-white text-xl">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen urbanflow-gradient p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <DashboardHeader
          title="Vehicle Driver Dashboard"
          subtitle={`Driver: ${driverId?.slice(0, 8) ?? 'N/A'} - ${activeDelivery ? 'Active delivery assigned' : 'Idle'}`}
        />

        {uiError && (
          <div className="mb-4 p-3 rounded-lg bg-red-600/90 text-white font-medium backdrop-blur-sm">
            {uiError}
          </div>
        )}

        {locationError && (
          <div className="mb-4 p-3 rounded-lg bg-yellow-500/90 text-white font-medium backdrop-blur-sm">
            {locationError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <KPICard icon={Package} label="Assigned Jobs" value={visibleDeliveries.length} />
          <KPICard icon={Navigation} label="Active Delivery" value={activeDelivery ? '1' : '0'} />
          <KPICard icon={CheckCircle} label="Completed Today" value={0} />
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`glass-button px-4 py-2 rounded-xl ${activeTab === 'jobs' ? 'glow-cyan' : ''}`}
          >
            Jobs
          </button>
          <button
            onClick={() => setActiveTab('navigation')}
            className={`glass-button px-4 py-2 rounded-xl ${activeTab === 'navigation' ? 'glow-cyan' : ''}`}
          >
            Navigation
          </button>
        </div>

        {activeTab === 'jobs' && (
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl text-primary-urban">Today's Jobs</h3>
              <span className="text-secondary-urban text-sm">{visibleDeliveries.length} jobs</span>
            </div>
            <div className="space-y-4">
              {visibleDeliveries.map((job) => (
                <div key={job.id} className="glass-card p-4 rounded-xl">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-primary-urban font-medium">Order #{job.id.slice(0, 8)}</p>
                      <p className="text-muted-urban text-sm">
                        Pickup: {job.from_lat.toFixed(4)}, {job.from_lng.toFixed(4)}
                      </p>
                      <p className="text-muted-urban text-sm">
                        Drop: {job.to_lat.toFixed(4)}, {job.to_lng.toFixed(4)}
                      </p>
                      <p className="text-muted-urban text-sm">Priority: {job.priority || 'Medium'}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-white/10 text-secondary-urban capitalize">
                      {job.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {job.status === 'assigned' && (
                      <>
                        <button
                          onClick={() => handleAccept(job.id)}
                          className="glass-button px-4 py-2 rounded-lg text-white bg-green-500/30 hover:bg-green-500/50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleReject(job.id)}
                          className="glass-button px-4 py-2 rounded-lg text-white bg-red-500/30 hover:bg-red-500/50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {job.status === 'accepted' && (
                      <>
                        <button
                          onClick={() => handleStartTrip(job)}
                          className="glass-button px-4 py-2 rounded-lg text-white bg-cyan-500/30 hover:bg-cyan-500/50"
                        >
                          Start Trip
                        </button>
                        <button
                          onClick={() => handleNavigate(job)}
                          className="glass-button px-4 py-2 rounded-lg text-white"
                        >
                          Navigate
                        </button>
                      </>
                    )}
                    {job.status === 'in_transit' && (
                      <button
                        onClick={() => handleNavigate(job)}
                        className="glass-button px-4 py-2 rounded-lg text-white"
                      >
                        Navigate
                      </button>
                    )}
                    {job.status === 'in_transit' && (
                      <button
                        onClick={() => handleMarkDelivered(job.id)}
                        className="glass-button px-4 py-2 rounded-lg text-white bg-green-500/30 hover:bg-green-500/50"
                      >
                        Mark Delivered
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {visibleDeliveries.length === 0 && (
                <div className="text-center py-8 text-secondary-urban">No active jobs yet.</div>
              )}
            </div>
          </GlassCard>
        )}

        {activeTab === 'navigation' && (
          <GlassCard>
            <h3 className="text-xl text-primary-urban mb-4">Live Navigation</h3>
            {!activeDelivery && <div className="text-secondary-urban">Accept a job to start navigation.</div>}
            {activeDelivery && (
              <>
                <div className="flex items-center gap-6 mb-4">
                  {routeInfo && (
                    <>
                      <div className="flex items-center gap-2 text-white">
                        <MapPin className="w-4 h-4 text-cyan-400" />
                        {routeInfo.distance} km
                      </div>
                      <div className="flex items-center gap-2 text-white">
                        <Clock className="w-4 h-4 text-cyan-400" />
                        {routeInfo.duration} min
                      </div>
                    </>
                  )}
                  {isRouteLoading && <span className="text-cyan-400 text-sm">Loading route...</span>}
                </div>
                {routeWarning && (
                  <div className="mb-3 p-2 rounded-lg bg-yellow-500/80 text-white text-sm">{routeWarning}</div>
                )}
                <div className="h-96 rounded-xl overflow-hidden">
                  {isGoogleLoaded ? (
                    <GoogleMap
                      mapContainerClassName="h-full w-full"
                      center={{
                        lat: userLocation?.lat ?? activeDelivery.from_lat,
                        lng: userLocation?.lng ?? activeDelivery.from_lng,
                      }}
                      zoom={13}
                      options={{
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: false,
                        mapId: GOOGLE_MAP_ID || undefined,
                      }}
                    >
                      {userLocation && (
                        <AdvancedMarker
                          position={{ lat: userLocation.lat, lng: userLocation.lng }}
                          label="U"
                          color="#22d3ee"
                          enabled={Boolean(GOOGLE_MAP_ID)}
                        />
                      )}
                      <AdvancedMarker
                        position={{ lat: activeDelivery.to_lat, lng: activeDelivery.to_lng }}
                        label="D"
                        color="#f97316"
                        enabled={Boolean(GOOGLE_MAP_ID)}
                      />
                      {routeInfo && (
                        <PolylineF
                          path={routeInfo.coordinates.map((p) => ({ lat: p[0], lng: p[1] }))}
                          options={{ strokeColor: '#00ffff', strokeOpacity: 0.8, strokeWeight: 5 }}
                        />
                      )}
                    </GoogleMap>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-sm text-white/70 bg-black/20">
                      Loading Google Map...
                    </div>
                  )}
                </div>
              </>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  );
}
