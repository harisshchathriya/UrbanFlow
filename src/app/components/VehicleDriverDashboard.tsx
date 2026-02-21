import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import {
  Truck,
  MapPin,
  Package,
  DollarSign,
  Camera,
  CheckCircle,
  AlertTriangle,
  Battery,
  Navigation,
  Trophy,
  Clock,
  QrCode,
  TrendingUp,
  ArrowLeft,
  Route,
  Gauge,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { supabase } from '../../services/supabaseClient';
import { CircleF, GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || '';

type VehicleStatus = {
  id: string;
  lat: number;
  lng: number;
  battery: number;
  status: 'moving' | 'idle' | 'charging' | 'on_delivery';
  updated_at: string;
};

type Delivery = {
  id: string;
  driver_id: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  packages: number;
  priority: 'High' | 'Medium' | 'Low';
  estimated_arrival: string;
  status: 'assigned' | 'accepted' | 'in_transit' | 'completed' | 'rejected';
  completed_at?: string;
  delivery_address?: string;
};

type ChargingStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  available: boolean;
};

type FreightZone = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  restricted: boolean;
};

type AQIReading = {
  id: string;
  area: string;
  lat: number;
  lng: number;
  aqi: number;
};

type RouteStep = {
  instruction: string;
  distance: number;
  duration: number;
};

type Alert = {
  id: string;
  type: 'zone' | 'aqi' | 'battery' | 'delay' | 'order' | 'sos';
  message: string;
  severity: 'info' | 'warning' | 'danger';
};

type CompletedDelivery = {
  id: string;
  delivery_address: string;
  completed_at: string;
  packages: number;
};

type DailyStats = {
  date: string;
  deliveries: number;
};

type RouteInfo = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  source: 'road' | 'fallback';
  steps: RouteStep[];
};

type DriverInfo = {
  id: string;
  name: string;
  vehicle_id?: string | null;
};

type DeliveryRow = Record<string, unknown>;

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const normalizeDelivery = (row: DeliveryRow): Delivery => {
  const rawStatus = String(row.status ?? 'pending').toLowerCase();
  const normalizedStatus: Delivery['status'] =
    rawStatus === 'assigned' ||
    rawStatus === 'accepted' ||
    rawStatus === 'in_transit' ||
    rawStatus === 'completed' ||
    rawStatus === 'rejected'
      ? (rawStatus as Delivery['status'])
      : rawStatus === 'pending'
      ? 'assigned'
      : rawStatus === 'delivered'
      ? 'completed'
      : 'assigned';

  const pickupLat =
    normalizeNumber(row.pickup_lat) ??
    normalizeNumber(row.from_lat) ??
    normalizeNumber(row.pickup_latitude) ??
    normalizeNumber(row.from_latitude) ??
    0;
  const pickupLng =
    normalizeNumber(row.pickup_lng) ??
    normalizeNumber(row.from_lng) ??
    normalizeNumber(row.pickup_longitude) ??
    normalizeNumber(row.from_longitude) ??
    0;
  const dropLat =
    normalizeNumber(row.drop_lat) ??
    normalizeNumber(row.to_lat) ??
    normalizeNumber(row.delivery_latitude) ??
    normalizeNumber(row.to_latitude) ??
    0;
  const dropLng =
    normalizeNumber(row.drop_lng) ??
    normalizeNumber(row.to_lng) ??
    normalizeNumber(row.delivery_longitude) ??
    normalizeNumber(row.to_longitude) ??
    0;

  return {
    id: String(row.id ?? ''),
    driver_id: String(row.driver_id ?? row.assigned_driver_id ?? ''),
    pickup_lat: pickupLat,
    pickup_lng: pickupLng,
    drop_lat: dropLat,
    drop_lng: dropLng,
    packages: Number(row.packages ?? row.package_count ?? 0),
    priority: (row.priority as Delivery['priority']) || 'Medium',
    estimated_arrival: String(row.estimated_arrival ?? row.eta ?? new Date().toISOString()),
    status: normalizedStatus,
    completed_at: row.completed_at ? String(row.completed_at) : undefined,
  };
};

const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getDistanceInKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  return getDistance(lat1, lng1, lat2, lng2) / 1000;
};

const fetchRoadRoute = async (
  start: [number, number],
  end: [number, number]
): Promise<RouteInfo | null> => {
  if (!ORS_API_KEY) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}&instructions=true&format=geojson`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Failed to fetch route');
    }

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const coordinates = data.features[0].geometry.coordinates.map(
        (coord: number[]) => [coord[1], coord[0]] as [number, number]
      );

      const distance = data.features[0].properties.segments[0].distance / 1000;
      const duration = data.features[0].properties.segments[0].duration / 60;

      const steps: RouteStep[] =
        data.features[0].properties?.segments?.[0]?.steps?.map((step: any) => ({
          instruction: String(step.instruction || 'Continue'),
          distance: Math.round((Number(step.distance || 0) / 1000) * 100) / 100,
          duration: Math.round(Number(step.duration || 0) / 60),
        })) || [];

      return {
        coordinates,
        distance: Math.round(distance * 10) / 10,
        duration: Math.round(duration),
        source: 'road',
        steps,
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching route:', error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('OpenRouteService timeout');
    }
    return null;
  }
};

const buildFallbackRoute = (
  start: [number, number],
  end: [number, number]
): RouteInfo => {
  const polyline: [number, number][] = [
    start,
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    end,
  ];
  const dist = getDistance(start[0], start[1], end[0], end[1]) / 1000;
  const duration = dist * 2;
  return {
    coordinates: polyline,
    duration: Math.round(duration),
    distance: Math.round(dist * 10) / 10,
    source: 'fallback',
    steps: [],
  };
};

const batteryColor = (battery: number) => {
  if (battery > 50) return 'text-green-400';
  if (battery > 20) return 'text-yellow-400';
  return 'text-red-400';
};

const MAX_RADIUS_KM = 6;
const DEMO_CENTER: [number, number] = [12.9716, 77.5946];
const DEMO_DRIVER_ID = 'demo-driver-001';
const DEMO_VEHICLE_ID = 'vehicle-001';

const demoVehicle: VehicleStatus = {
  id: DEMO_VEHICLE_ID,
  lat: DEMO_CENTER[0],
  lng: DEMO_CENTER[1],
  battery: 78,
  status: 'moving',
  updated_at: new Date().toISOString(),
};

const demoDeliveries: Delivery[] = [
  {
    id: 'DEL-1001',
    driver_id: DEMO_DRIVER_ID,
    pickup_lat: 12.9752,
    pickup_lng: 77.6033,
    drop_lat: 12.9591,
    drop_lng: 77.6124,
    packages: 4,
    priority: 'High',
    estimated_arrival: '25 min',
    status: 'in_transit',
  },
  {
    id: 'DEL-1002',
    driver_id: DEMO_DRIVER_ID,
    pickup_lat: 12.9878,
    pickup_lng: 77.5796,
    drop_lat: 12.9981,
    drop_lng: 77.5904,
    packages: 2,
    priority: 'Medium',
    estimated_arrival: '45 min',
    status: 'accepted',
  },
  {
    id: 'DEL-1003',
    driver_id: DEMO_DRIVER_ID,
    pickup_lat: 12.9459,
    pickup_lng: 77.5695,
    drop_lat: 12.9321,
    drop_lng: 77.5602,
    packages: 1,
    priority: 'Low',
    estimated_arrival: 'Delivered',
    status: 'completed',
    completed_at: new Date().toISOString(),
  },
];

const demoStations: ChargingStation[] = [
  { id: 'CS-01', name: 'MG Road FastCharge', lat: 12.9759, lng: 77.6065, available: true },
  { id: 'CS-02', name: 'Indiranagar Hub', lat: 12.9710, lng: 77.6410, available: false },
];

const demoZones: FreightZone[] = [
  { id: 'Z-01', name: 'CBD Restricted', lat: 12.9716, lng: 77.5946, radius: 1200, restricted: true },
  { id: 'Z-02', name: 'EV Priority Zone', lat: 12.9632, lng: 77.6001, radius: 900, restricted: false },
];

const demoAqi: AQIReading[] = [
  { id: 'AQI-1', area: 'Shivaji Nagar', lat: 12.9867, lng: 77.6047, aqi: 168 },
  { id: 'AQI-2', area: 'Koramangala', lat: 12.9352, lng: 77.6245, aqi: 132 },
];

const demoDailyStats: DailyStats[] = [
  { date: '3 days ago', deliveries: 6 },
  { date: '2 days ago', deliveries: 8 },
  { date: 'Yesterday', deliveries: 5 },
  { date: 'Today', deliveries: 3 },
];

const formatCoord = (value?: number | null) => (value == null ? 'N/A' : value.toFixed(4));

export function VehicleDriverDashboard() {
  const googleMapsApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps-vehicle-driver',
    googleMapsApiKey,
  });

  const navigate = useNavigate();
  const { driverId: routeDriverId } = useParams<{ driverId: string }>();

  const [showSOSConfirmModal, setShowSOSConfirmModal] = useState(false);
  const [sosStatus, setSosStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [sosMessage, setSosMessage] = useState('');
  const [activeTab, setActiveTab] = useState('jobs');
  const [isClient, setIsClient] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const [driverUuid, setDriverUuid] = useState<string | null>(null);
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<string | null>(null);

  const [showNavigationMap, setShowNavigationMap] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeWarning, setRouteWarning] = useState<string | null>(null);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  const [rejectedJobs, setRejectedJobs] = useState<string[]>([]);
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null);
  const [completedDeliveries, setCompletedDeliveries] = useState<CompletedDelivery[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);

  const [vehicle, setVehicle] = useState<VehicleStatus | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [chargingStations, setChargingStations] = useState<ChargingStation[]>([]);
  const [zones, setZones] = useState<FreightZone[]>([]);
  const [aqiReadings, setAqiReadings] = useState<AQIReading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const demoMode = Boolean(routeDriverId);

  const [performance, setPerformance] = useState({
    completedToday: 0,
    onTimeRate: 0,
    carbonSaved: 0,
    distanceTraveled: 0,
  });

  const [ecoScore, setEcoScore] = useState(0);

  const [podOtp, setPodOtp] = useState('');
  const [podPhoto, setPodPhoto] = useState<File | null>(null);
  const [podSignature, setPodSignature] = useState<Blob | null>(null);
  const [podLoading, setPodLoading] = useState(false);
  const [podSuccess, setPodSuccess] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  const buildMarkerIcon = useCallback(
    (url: string, size: number) =>
      isGoogleLoaded && window.google
        ? { url, scaledSize: new window.google.maps.Size(size, size) }
        : { url },
    [isGoogleLoaded]
  );

  const locationInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const routeUpdateTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastRouteOriginRef = useRef<[number, number] | null>(null);
  const vehicleRef = useRef<VehicleStatus | null>(null);
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const driverVehicleIdRef = useRef<string | null>(null);

  const pendingJobs = useMemo(
    () =>
      deliveries.filter(
        (d) => d.status !== 'completed' && d.status !== 'rejected' && !rejectedJobs.includes(d.id)
      ),
    [deliveries, rejectedJobs]
  );

  const featuredJob = useMemo(() => {
    const actionable = pendingJobs.find(
      (job) =>
        job.status === 'assigned' &&
        (!job.driver_id || job.driver_id === driverUuid)
    );
    if (actionable) return actionable;
    if (pendingJobs.length > 0) return pendingJobs[0];
    return activeDelivery;
  }, [pendingJobs, activeDelivery, driverUuid]);

  const refreshPerformanceMetrics = useCallback(
    (deliveryRows: Delivery[], batteryLevel?: number | null) => {
      const delivered = deliveryRows.filter((d) => d.status === 'completed');
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const deliveredToday = delivered.filter((d) => {
        if (!d.completed_at) return false;
        return new Date(d.completed_at).getTime() >= startOfToday.getTime();
      }).length;
      const totalDistance = deliveryRows.reduce((sum, d) => {
        return sum + getDistanceInKm(d.pickup_lat, d.pickup_lng, d.drop_lat, d.drop_lng);
      }, 0);

      const onTimeDeliveries = delivered.filter((d) => {
        if (!d.completed_at || !d.estimated_arrival) return false;
        return new Date(d.completed_at).getTime() <= new Date(d.estimated_arrival).getTime();
      }).length;
      const onTimeRate = delivered.length > 0 ? Math.round((onTimeDeliveries / delivered.length) * 100) : 0;
      const distanceTraveled = Math.round(totalDistance * 10) / 10;
      const carbonSaved = Math.round(distanceTraveled * 0.2 * 10) / 10;
      const effectiveBattery = batteryLevel ?? 0;
      const ecoScore = Math.min(
        100,
        Math.round(onTimeRate * 0.6 + Math.min(delivered.length * 4, 25) + Math.min(effectiveBattery * 0.15, 15))
      );

      setPerformance((prev) => ({
        ...prev,
        completedToday: deliveredToday,
        onTimeRate,
        carbonSaved,
        distanceTraveled,
      }));
      setEcoScore(ecoScore);
    },
    []
  );

  useEffect(() => {
    vehicleRef.current = vehicle;
  }, [vehicle]);

  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    driverVehicleIdRef.current = driverInfo?.vehicle_id ?? null;
  }, [driverInfo?.vehicle_id]);

  useEffect(() => {
    setIsClient(true);

    const getSession = async () => {
      if (demoMode) {
        setLoading(false);
        return;
      }
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      setSession(session);

      if (sessionError) {
        console.error(sessionError);
        setUiMessage('Unable to verify session.');
        setLoading(false);
        return;
      }

      if (!session) {
        navigate('/login/vehicle-driver');
        return;
      }

      const { data: driver, error } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.error(error);
        setDriverInfo(null);
        setUiMessage('Driver profile not available.');
        setLoading(false);
        return;
      }

      if (driver) {
        setDriverUuid(driver.id);
        setDriverInfo({ id: driver.id, name: driver.name });
      }

      setLoading(false);
    };

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (demoMode) return;
      setSession(session);
      if (!session) {
        navigate('/login/vehicle-driver');
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [navigate, demoMode]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    const success = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });
      setMapCenter([latitude, longitude]);
      setLocationError(null);
    };

    const error = (error: GeolocationPositionError) => {
      setLocationError(`Error getting location: ${error.message}`);
      const fallbackVehicle = vehicleRef.current;
      if (fallbackVehicle) {
        setUserLocation({ lat: fallbackVehicle.lat, lng: fallbackVehicle.lng });
        setMapCenter([fallbackVehicle.lat, fallbackVehicle.lng]);
      }
    };

    const watchId = navigator.geolocation.watchPosition(success, error, {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleSOSClick = () => {
    setShowSOSConfirmModal(true);
    setSosStatus('idle');
    setSosMessage('');
  };

  const handleSOSConfirm = async () => {
    if (demoMode) {
      setSosStatus('success');
      setSosMessage('SOS sent successfully! Help is on the way.');
      const sosAlert: Alert = {
        id: `sos-${Date.now()}`,
        type: 'sos',
        message: 'SOS sent to control center',
        severity: 'danger',
      };
      setAlerts((prev) => [sosAlert, ...prev]);
      setTimeout(() => {
        setShowSOSConfirmModal(false);
      }, 2000);
      return;
    }

    if (!userLocation) {
      setSosStatus('error');
      setSosMessage('Cannot get your current location. Please enable location services.');
      return;
    }

    if (!driverUuid) {
      setSosStatus('error');
      setSosMessage('Driver information not available.');
      return;
    }

    setSosStatus('sending');

    try {
      const { error } = await supabase
        .from('emergency_alerts')
        .insert({
          driver_id: driverUuid,
          driver_name: driverInfo?.name || 'Unknown Driver',
          current_latitude: userLocation.lat,
          current_longitude: userLocation.lng,
          current_order_id: activeDelivery?.id || null,
          status: 'active',
          created_at: new Date().toISOString(),
        });

      if (error) throw error;

      setSosStatus('success');
      setSosMessage('SOS sent successfully! Help is on the way.');

      const sosAlert: Alert = {
        id: `sos-${Date.now()}`,
        type: 'sos',
        message: 'SOS sent to control center',
        severity: 'danger',
      };
      setAlerts((prev) => [sosAlert, ...prev]);

      setTimeout(() => {
        setShowSOSConfirmModal(false);
      }, 3000);
    } catch (error) {
      console.error('Error sending SOS:', error);
      setSosStatus('error');
      setSosMessage('Failed to send SOS. Please try again.');
    }
  };

  const handleSOSCancel = () => {
    setShowSOSConfirmModal(false);
    setSosStatus('idle');
    setSosMessage('');
  };

  const fetchRouteForDelivery = useCallback(
    async (targetDelivery?: Delivery) => {
      const currentLocation = userLocationRef.current;
      const deliveryTarget = targetDelivery || activeDelivery;
      if (!currentLocation || !deliveryTarget) return;

      setIsRouteLoading(true);
      const start: [number, number] = [currentLocation.lat, currentLocation.lng];
      const end: [number, number] = [deliveryTarget.drop_lat, deliveryTarget.drop_lng];

      try {
        const route = await fetchRoadRoute(start, end);
        if (route) {
          setRouteInfo(route);
          setRouteWarning(null);
          lastRouteOriginRef.current = start;
        } else {
          setRouteInfo(buildFallbackRoute(start, end));
          setRouteWarning('Routing API unavailable. Showing fallback route (not road-accurate).');
          lastRouteOriginRef.current = start;
        }
      } catch (error) {
        console.error('Error fetching route:', error);
        setRouteInfo(buildFallbackRoute(start, end));
        setRouteWarning('Failed to fetch road route. Showing fallback route (not road-accurate).');
        lastRouteOriginRef.current = start;
      } finally {
        setIsRouteLoading(false);
      }
    },
    [activeDelivery]
  );

  const handleOpenNavigationMap = useCallback(() => {
    if (activeDelivery) {
      setShowNavigationMap(true);
      void fetchRouteForDelivery(activeDelivery);
    }
  }, [activeDelivery, fetchRouteForDelivery]);

  const handleCloseNavigationMap = () => {
    setShowNavigationMap(false);
    setRouteInfo(null);
    setRouteWarning(null);
  };

  useEffect(() => {
    const routeVisible = showNavigationMap || activeTab === 'navigation';
    if (!routeVisible || !userLocation || !activeDelivery) return;

    const lastOrigin = lastRouteOriginRef.current;
    const movedEnough =
      !lastOrigin || getDistanceInKm(lastOrigin[0], lastOrigin[1], userLocation.lat, userLocation.lng) > 0.05;

    if (!movedEnough) return;

    if (routeUpdateTimeout.current) {
      clearTimeout(routeUpdateTimeout.current);
    }

    routeUpdateTimeout.current = setTimeout(() => {
      void fetchRouteForDelivery();
    }, 150);

    return () => {
      if (routeUpdateTimeout.current) {
        clearTimeout(routeUpdateTimeout.current);
      }
    };
  }, [userLocation, showNavigationMap, activeTab, activeDelivery, fetchRouteForDelivery]);

  useEffect(() => {
    if (!demoMode) return;
    const demoActive = demoDeliveries.find((d) => d.status === 'in_transit') || null;

    setDriverUuid(DEMO_DRIVER_ID);
    setDriverInfo({ id: DEMO_DRIVER_ID, name: 'Demo Driver', vehicle_id: DEMO_VEHICLE_ID });
    setVehicle(demoVehicle);
    setDeliveries(demoDeliveries);
    setChargingStations(demoStations);
    setZones(demoZones);
    setAqiReadings(demoAqi);
    setDailyStats(demoDailyStats);
    setUserLocation({ lat: DEMO_CENTER[0], lng: DEMO_CENTER[1] });
    setMapCenter(DEMO_CENTER);
    setAlerts([
      { id: 'AL-1', type: 'battery', message: 'Battery optimal for next 60 km.', severity: 'info' },
      { id: 'AL-2', type: 'aqi', message: 'AQI high near Shivaji Nagar. Consider alternate route.', severity: 'warning' },
    ]);
    setCompletedDeliveries(
      demoDeliveries
        .filter((d) => d.status === 'completed')
        .map((d) => ({
          id: d.id,
          delivery_address: `${formatCoord(d.drop_lat)}, ${formatCoord(d.drop_lng)}`,
          completed_at: d.completed_at ? new Date(d.completed_at).toLocaleTimeString() : 'N/A',
          packages: d.packages,
        }))
    );
    setPerformance({
      completedToday: demoDeliveries.filter((d) => d.status === 'completed').length,
      onTimeRate: 96,
      carbonSaved: 12.8,
      distanceTraveled: 42.5,
    });
    setEcoScore(88);
    setActiveDelivery(demoActive);
    if (demoActive) {
      setRouteInfo(buildFallbackRoute([demoVehicle.lat, demoVehicle.lng], [demoActive.drop_lat, demoActive.drop_lng]));
    } else {
      setRouteInfo(null);
    }
    setLoading(false);
  }, [demoMode]);

  const refreshDeliveriesList = useCallback(
    async (batteryLevel?: number | null) => {
      if (!driverUuid) return;

      const [ownDeliveriesRes, openDeliveriesRes] = await Promise.all([
        supabase
          .from('deliveries')
          .select('*')
          .eq('driver_id', driverUuid)
          .order('estimated_arrival', { ascending: true })
          .limit(100),
        supabase
          .from('deliveries')
          .select('*')
          .in('status', ['assigned', 'pending'])
          .is('driver_id', null)
          .order('estimated_arrival', { ascending: true })
          .limit(100),
      ]);

      if (ownDeliveriesRes.error) {
        throw ownDeliveriesRes.error;
      }
      if (openDeliveriesRes.error) {
        throw openDeliveriesRes.error;
      }

      const mergedRows = [...(ownDeliveriesRes.data || []), ...(openDeliveriesRes.data || [])];
      const uniqueRows = Array.from(new Map(mergedRows.map((row) => [row.id, row])).values());
      const normalized = (uniqueRows as DeliveryRow[]).map(normalizeDelivery);
      setDeliveries(normalized);
      refreshPerformanceMetrics(normalized, batteryLevel);

      if (activeDelivery && !normalized.some((d) => d.id === activeDelivery.id)) {
        setActiveDelivery(null);
        setShowNavigationMap(false);
        setRouteInfo(null);
      }
    },
    [driverUuid, refreshPerformanceMetrics, activeDelivery]
  );

  useEffect(() => {
    if (demoMode) return;
    if (!driverUuid) return;

    const fetchInitialData = async () => {
      setLoading(true);
      try {
        let vehicleQuery = supabase.from('vehicle_status').select('*');

        if (demoMode && routeDriverId) {
          vehicleQuery = vehicleQuery.eq('vehicle_id', routeDriverId);
        } else if (driverInfo?.vehicle_id) {
          vehicleQuery = vehicleQuery.eq('vehicle_id', driverInfo.vehicle_id);
        } else {
          if (driverUuid) {
            vehicleQuery = vehicleQuery.eq('driver_id', driverUuid);
          }
        }

        const { data: vehicleData, error: vehicleError } = await vehicleQuery.maybeSingle();

        if (!vehicleError && vehicleData) {
          setVehicle({
            id: vehicleData.vehicle_id || vehicleData.id,
            lat: vehicleData.latitude,
            lng: vehicleData.longitude,
            battery: vehicleData.battery_level,
            status: vehicleData.status,
            updated_at: vehicleData.updated_at,
          });
        } else if (vehicleError) {
          console.error('Error fetching vehicle:', vehicleError);
        }

        await refreshDeliveriesList(vehicleData?.battery_level);

        const { data: stationsData, error: stationsError } = await supabase
          .from('charging_stations')
          .select('*');

        if (stationsError) {
          console.error('Error fetching charging stations:', stationsError);
        }

        if (stationsData) {
          setChargingStations(
            stationsData.map((s) => ({
              ...s,
              lat: s.latitude,
              lng: s.longitude,
            }))
          );
        }

        const { data: zonesData, error: zonesError } = await supabase
          .from('freight_zones')
          .select('*');

        if (zonesError) {
          console.error('Error fetching freight zones:', zonesError);
        }

        if (zonesData) {
          setZones(
            zonesData.map((z) => ({
              ...z,
              lat: z.latitude,
              lng: z.longitude,
            }))
          );
        }

        const { data: aqiData, error: aqiError } = await supabase
          .from('aqi_readings')
          .select('*');

        if (aqiError) {
          console.error('Error fetching AQI readings:', aqiError);
        }

        if (aqiData) {
          setAqiReadings(
            aqiData.map((a) => ({
              ...a,
              lat: a.latitude,
              lng: a.longitude,
            }))
          );
        }

        await fetchCompletedDeliveries();
        await fetchDeliveryStats();

        let activeOrderQuery = supabase.from('orders').select('*').eq('status', 'accepted');
        if (!demoMode && driverUuid) {
          activeOrderQuery = activeOrderQuery.eq('assigned_driver_id', driverUuid);
        }
        const { data: activeOrder, error: activeOrderError } = await activeOrderQuery.maybeSingle();

        if (activeOrderError) {
          console.error('Error fetching active order:', activeOrderError);
        }

        if (activeOrder) {
          setActiveDelivery({
            id: activeOrder.id,
            driver_id: driverUuid || '',
            pickup_lat: activeOrder.pickup_latitude,
            pickup_lng: activeOrder.pickup_longitude,
            drop_lat: activeOrder.delivery_latitude,
            drop_lng: activeOrder.delivery_longitude,
            packages: activeOrder.packages || 1,
            priority: (activeOrder.priority as 'High' | 'Medium' | 'Low') || 'Medium',
            estimated_arrival: new Date().toISOString(),
            status: 'accepted',
          });
        }

      } catch (error) {
        console.error('Error fetching data:', error);
        setUiMessage('Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [driverUuid, driverInfo, demoMode, refreshDeliveriesList]);

  const fetchCompletedDeliveries = async () => {
    if (!driverUuid && !demoMode) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let completedQuery = supabase
      .from('deliveries')
      .select('*')
      .in('status', ['completed', 'delivered'])
      .gte('completed_at', today.toISOString());

    if (!demoMode && driverUuid) {
      completedQuery = completedQuery.eq('driver_id', driverUuid);
    }

    const { data, error } = await completedQuery;

    if (error) {
      console.error(error);
      return;
    }

    if (data) {
      const completed: CompletedDelivery[] = (data as DeliveryRow[]).map((row) => {
        const normalized = normalizeDelivery(row);
        return {
          id: normalized.id,
          delivery_address: `${formatCoord(normalized.drop_lat)}, ${formatCoord(normalized.drop_lng)}`,
          completed_at: normalized.completed_at ? new Date(normalized.completed_at).toLocaleTimeString() : 'N/A',
          packages: normalized.packages,
        };
      });
      setCompletedDeliveries(completed);
      setPerformance((prev) => ({ ...prev, completedToday: completed.length }));
    }
  };

  const fetchDeliveryStats = async () => {
    if (!driverUuid && !demoMode) return;

    const stats: DailyStats[] = [];

    for (let i = 3; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      let statsQuery = supabase
        .from('deliveries')
        .select('*', { count: 'exact', head: true })
        .in('status', ['completed', 'delivered'])
        .gte('completed_at', date.toISOString())
        .lt('completed_at', nextDate.toISOString());

      if (!demoMode && driverUuid) {
        statsQuery = statsQuery.eq('driver_id', driverUuid);
      }

      const { count, error } = await statsQuery;

      if (error) {
        console.error(error);
      }

      const dayName = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${i} days ago`;
      stats.push({
        date: dayName,
        deliveries: count || 0,
      });
    }

    setDailyStats(stats);
  };

  useEffect(() => {
    if (demoMode) return;
    if (!driverUuid) return;

    const vehicleId = driverVehicleIdRef.current;
    let vehicleSub: ReturnType<typeof supabase.channel> | null = null;

    if (vehicleId) {
      vehicleSub = supabase
        .channel('vehicle-status')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'vehicle_status', filter: `vehicle_id=eq.${vehicleId}` },
          (payload) => {
            setVehicle({
              id: payload.new.vehicle_id,
              lat: payload.new.latitude,
              lng: payload.new.longitude,
              battery: payload.new.battery_level,
              status: payload.new.status,
              updated_at: payload.new.updated_at,
            });
          }
        )
        .subscribe();
    }

    const deliveriesSub = supabase
      .channel('deliveries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deliveries' },
        async () => {
          try {
            await refreshDeliveriesList();
            fetchCompletedDeliveries();
            fetchDeliveryStats();
          } catch (error) {
            console.error(error);
          }
        }
      )
      .subscribe();

    const ordersSub = supabase
      .channel('orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        async (payload) => {
          const location = userLocationRef.current;
          if (location && (payload.new.status === 'pending' || payload.new.status === 'assigned')) {
            const distance = getDistanceInKm(
              location.lat,
              location.lng,
              payload.new.pickup_latitude,
              payload.new.pickup_longitude
            );

            if (distance <= MAX_RADIUS_KM) {
              const incomingDelivery: Delivery = {
                id: payload.new.id,
                driver_id: payload.new.assigned_driver_id ?? '',
                pickup_lat: payload.new.pickup_latitude,
                pickup_lng: payload.new.pickup_longitude,
                drop_lat: payload.new.delivery_latitude,
                drop_lng: payload.new.delivery_longitude,
                packages: payload.new.packages || 1,
                priority: (payload.new.priority as 'High' | 'Medium' | 'Low') || 'Medium',
                estimated_arrival: payload.new.estimated_arrival || new Date(Date.now() + 30 * 60000).toISOString(),
                status: 'assigned',
              };
              setDeliveries((prev) => (prev.some((d) => d.id === incomingDelivery.id) ? prev : [incomingDelivery, ...prev]));

              const newAlert: Alert = {
                id: `order-${payload.new.id}-${Date.now()}`,
                type: 'order',
                message: `New job available: ${distance.toFixed(1)}km away.`,
                severity: 'info',
              };
              setAlerts((prev) => [newAlert, ...prev.slice(0, 2)]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      if (vehicleSub) {
        supabase.removeChannel(vehicleSub);
      }
      supabase.removeChannel(deliveriesSub);
      supabase.removeChannel(ordersSub);
    };
  }, [driverUuid, refreshDeliveriesList, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    if (!driverUuid || !userLocation || !activeDelivery) return;

    const updateLocation = async () => {
      await supabase
        .from('drivers')
        .update({
          current_latitude: userLocation.lat,
          current_longitude: userLocation.lng,
          destination_latitude: activeDelivery.drop_lat,
          destination_longitude: activeDelivery.drop_lng,
          current_order_id: activeDelivery.id,
          status: 'on_delivery',
          updated_at: new Date(),
        })
        .eq('id', driverUuid);

      const vehicleId = driverVehicleIdRef.current;
      if (!vehicleId) return;

      await supabase
        .from('vehicle_status')
        .update({
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          status: 'moving',
          updated_at: new Date(),
        })
        .eq('vehicle_id', vehicleId);
    };

    updateLocation();
    locationInterval.current = setInterval(updateLocation, 5000);

    return () => {
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    };
  }, [driverUuid, userLocation, activeDelivery, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    if (!vehicle) return;

    const newAlerts: Alert[] = [];

    zones.forEach((zone) => {
      if (zone.restricted) {
        const dist = getDistance(vehicle.lat, vehicle.lng, zone.lat, zone.lng);
        if (dist < zone.radius) {
          newAlerts.push({
            id: `zone-${zone.id}-${Date.now()}`,
            type: 'zone',
            message: `Entered restricted zone: ${zone.name}`,
            severity: 'danger',
          });
        }
      }
    });

    aqiReadings.forEach((a) => {
      if (a.aqi > 150) {
        const dist = getDistance(vehicle.lat, vehicle.lng, a.lat, a.lng);
        if (dist < 2000) {
          newAlerts.push({
            id: `aqi-${a.id}-${Date.now()}`,
            type: 'aqi',
            message: `High AQI (${a.aqi}) in ${a.area}. Consider rerouting.`,
            severity: 'warning',
          });
        }
      }
    });

    if (vehicle.battery < 20) {
      newAlerts.push({
        id: `battery-${Date.now()}`,
        type: 'battery',
        message: `Low battery (${vehicle.battery}%). Nearest station suggested.`,
        severity: 'warning',
      });
    }
    if (vehicle.battery < 5) {
      newAlerts.push({
        id: `battery-critical-${Date.now()}`,
        type: 'battery',
        message: 'Critical battery! Charge immediately.',
        severity: 'danger',
      });
    }

    setAlerts((prev) => [...newAlerts.slice(0, 2), ...prev.slice(0, 1)]);
  }, [vehicle, zones, aqiReadings, demoMode]);

  useEffect(() => {
    if (!activeDelivery) {
      setRouteInfo(null);
      return;
    }

    if (activeTab === 'navigation' || showNavigationMap) {
      void fetchRouteForDelivery();
    }
  }, [activeDelivery, activeTab, showNavigationMap, fetchRouteForDelivery]);

  const nearestChargingStation = useCallback(() => {
    if (!vehicle || chargingStations.length === 0) return null;
    let nearest = chargingStations[0];
    let minDist = getDistance(vehicle.lat, vehicle.lng, nearest.lat, nearest.lng);
    chargingStations.forEach((s) => {
      const d = getDistance(vehicle.lat, vehicle.lng, s.lat, s.lng);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    });
    return { station: nearest, distance: minDist };
  }, [vehicle, chargingStations]);

  const openNavigationForJob = useCallback(
    (job: Delivery, openFullMap = true) => {
      setActiveDelivery(job);
      setActiveTab('navigation');
      if (openFullMap) {
        setShowNavigationMap(true);
      }
      setTimeout(() => {
        void fetchRouteForDelivery(job);
      }, 0);
    },
    [fetchRouteForDelivery]
  );

  const handleAccept = async (deliveryId: string) => {
    if (!driverUuid) return;
    const job = deliveries.find((d) => d.id === deliveryId);
    if (!job) return;

    if (job.status !== 'assigned') {
      setUiMessage('Only assigned jobs can be accepted.');
      return;
    }

    if (activeDelivery && activeDelivery.id !== deliveryId && activeDelivery.status !== 'completed') {
      setUiMessage('Finish current active delivery before accepting a new one.');
      return;
    }

    if (demoMode) {
      const accepted = { ...job, driver_id: driverUuid, status: 'accepted' as const };
      setDeliveries((prev) => prev.map((d) => (d.id === job.id ? accepted : d)));
      setActiveDelivery(accepted);
      return;
    }

    try {
      const optimisticAccepted = { ...job, driver_id: driverUuid, status: 'accepted' as const };
      setDeliveries((prev) => prev.map((d) => (d.id === deliveryId ? optimisticAccepted : d)));
      setActiveDelivery(optimisticAccepted);

      const { error: deliveryError } = await supabase
        .from('deliveries')
        .update({
          status: 'accepted',
          driver_id: driverUuid,
          assigned_driver_id: driverUuid,
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .eq('status', 'assigned')
        .select('id');

      if (deliveryError) {
        throw deliveryError;
      }

      const { error: orderError } = await supabase
        .from('orders')
        .update({
          status: 'accepted',
          assigned_driver_id: driverUuid,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .eq('status', 'assigned');

      if (orderError) {
        console.warn('Order table update skipped:', orderError.message);
      }

      setAlerts((prev) => [
        {
          id: `accept-${deliveryId}-${Date.now()}`,
          type: 'order',
          message: `Job ${deliveryId.slice(0, 8)} accepted.`,
          severity: 'info',
        },
        ...prev.slice(0, 2),
      ]);
      setUiMessage(null);
    } catch (error) {
      console.error('Error accepting job:', error);
      setUiMessage('This job could not be accepted. It may already be taken by another driver.');
      await refreshDeliveriesList();
    }
  };

  const handleReject = async (deliveryId: string) => {
    if (!driverUuid) return;
    const job = deliveries.find((d) => d.id === deliveryId);
    if (!job) return;

    setRejectedJobs((prev) => [...prev, deliveryId]);
    setDeliveries((prev) => prev.filter((d) => d.id !== deliveryId));
    if (activeDelivery?.id === deliveryId) {
      setActiveDelivery(null);
      setShowNavigationMap(false);
      setRouteInfo(null);
    }

    if (demoMode) {
      return;
    }

    const { error: deliveryError } = await supabase
      .from('deliveries')
      .update({
        status: 'rejected',
        driver_id: null,
        assigned_driver_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('status', 'assigned');

    if (deliveryError) {
      const { error: fallbackError } = await supabase
        .from('deliveries')
        .update({
          status: 'assigned',
          assigned_driver_id: null,
          driver_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deliveryId);
      if (fallbackError) {
        console.warn('Reject fallback failed:', fallbackError.message);
      }
    }

    const { error: orderError } = await supabase
      .from('orders')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('status', 'assigned');
    if (orderError) {
      console.warn('Order reject update skipped:', orderError.message);
    }
  };

  const handleCompleteDelivery = async (deliveryId: string) => {
    if (demoMode) {
      setDeliveries((prev) =>
        prev.map((d) =>
          d.id === deliveryId ? { ...d, status: 'completed', completed_at: new Date().toISOString() } : d
        )
      );
      setActiveDelivery(null);
      setShowNavigationMap(false);
      setRouteInfo(null);
      fetchCompletedDeliveries();
      fetchDeliveryStats();
      return;
    }

    try {
      await supabase
        .from('deliveries')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId);

      setActiveDelivery(null);
      setShowNavigationMap(false);
      setRouteInfo(null);

      await supabase
        .from('drivers')
        .update({
          status: 'idle',
          current_order_id: null,
          updated_at: new Date(),
        })
        .eq('id', driverUuid);

      fetchCompletedDeliveries();
      fetchDeliveryStats();
    } catch (error) {
      console.error('Error completing delivery:', error);
      setUiMessage('Failed to complete delivery.');
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPodPhoto(e.target.files[0]);
    }
  };

  const startDraw = () => {
    isDrawing.current = true;
  };

  const endDraw = () => {
    isDrawing.current = false;
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x =
      'touches' in e
        ? e.touches[0].clientX - rect.left
        : (e as React.MouseEvent).clientX - rect.left;

    const y =
      'touches' in e
        ? e.touches[0].clientY - rect.top
        : (e as React.MouseEvent).clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const saveSignatureBlob = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (blob) setPodSignature(blob);
    });
  };

  const handleSubmitPOD = async () => {
    if (!activeDelivery) {
      setUiMessage('No active delivery');
      return;
    }

    setPodLoading(true);

    if (demoMode) {
      setTimeout(() => {
        setPodLoading(false);
        setPodSuccess(true);
        setTimeout(() => {
          setPodSuccess(false);
          setActiveDelivery(null);
          fetchCompletedDeliveries();
          fetchDeliveryStats();
        }, 2000);
      }, 800);
      return;
    }

    const { data: deliveryData, error: fetchError } = await supabase
      .from('deliveries')
      .select('otp_code')
      .eq('id', activeDelivery.id)
      .single();

    if (fetchError || !deliveryData) {
      setUiMessage('Could not verify OTP');
      setPodLoading(false);
      return;
    }

    if (deliveryData.otp_code !== podOtp) {
      setUiMessage('Invalid OTP');
      setPodLoading(false);
      return;
    }

    if (!podPhoto || !podSignature) {
      setUiMessage('Complete photo and signature');
      setPodLoading(false);
      return;
    }

    if (!podPhoto.type.startsWith('image/')) {
      setUiMessage('Photo must be an image file');
      setPodLoading(false);
      return;
    }

    try {
      const folder = `driver_${driverUuid}`;
      const timestamp = Date.now();
      const photoPath = `${folder}/photo_${activeDelivery.id}_${timestamp}.jpg`;

      const { error: photoError } = await supabase.storage
        .from('pod-proofs')
        .upload(photoPath, podPhoto, {
          contentType: podPhoto.type,
          upsert: false,
        });

      if (photoError) {
        console.error('Photo upload error:', photoError);
        setUiMessage('Photo upload failed');
        setPodLoading(false);
        return;
      }

      const signaturePath = `${folder}/sign_${activeDelivery.id}_${timestamp}.png`;

      const { error: signatureError } = await supabase.storage
        .from('pod-proofs')
        .upload(signaturePath, podSignature, {
          contentType: 'image/png',
          upsert: false,
        });

      if (signatureError) {
        console.error('Signature upload error:', signatureError);
        setUiMessage('Signature upload failed');
        setPodLoading(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('deliveries')
        .update({
          status: 'completed',
          proof_photo: photoPath,
          proof_signature: signaturePath,
          completed_at: new Date().toISOString(),
        })
        .eq('id', activeDelivery.id);

      if (updateError) {
        console.error('Delivery update error:', updateError);
        setUiMessage('Failed to update delivery status');
        setPodLoading(false);
        return;
      }

      setPodLoading(false);
      setPodSuccess(true);
      setUiMessage(null);

      setTimeout(() => {
        setPodSuccess(false);
        setActiveDelivery(null);
        fetchCompletedDeliveries();
        fetchDeliveryStats();
      }, 3000);
    } catch (error) {
      console.error('Unexpected error in POD submission:', error);
      setUiMessage('Something went wrong. Please try again.');
      setPodLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center">
        <p className="text-white text-xl">Loading dashboard...</p>
      </div>
    );
  }

  if (!session && !routeDriverId) {
    return (
      <div className="min-h-screen urbanflow-gradient p-6 flex items-center justify-center">
        <p className="text-white text-xl">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen urbanflow-gradient p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <DashboardHeader
          title="Vehicle Driver Dashboard"
          subtitle={`Vehicle: ${driverInfo?.vehicle_id || 'N/A'}  ${vehicle?.status || 'idle'} ${userLocation ? ' Location active' : ''}`}
        />

        {uiMessage && (
          <div className="mb-4 p-3 rounded-lg bg-red-600/90 text-white font-medium backdrop-blur-sm">
            {uiMessage}
          </div>
        )}

        {locationError && (
          <div className="mb-4 p-3 rounded-lg bg-yellow-500/90 text-white font-medium backdrop-blur-sm">
            {locationError} - Using vehicle location as fallback
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mb-4 space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg text-white font-medium backdrop-blur-sm flex items-center justify-between ${
                  alert.severity === 'danger'
                    ? 'bg-red-600/90'
                    : alert.severity === 'warning'
                    ? 'bg-orange-500/90'
                    : 'bg-blue-500/90'
                }`}
              >
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {showSOSConfirmModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]">
            <div className="glass-card-strong rounded-3xl p-8 max-w-md w-full">
              <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="text-2xl text-primary-urban text-center mb-4">Emergency SOS</h2>

              {sosStatus === 'idle' && (
                <>
                  <p className="text-secondary-urban text-center mb-6">
                    Are you sure you want to send an emergency alert? This will notify the control center immediately.
                  </p>
                  <div className="space-y-3">
                    <button
                      onClick={handleSOSConfirm}
                      className="glass-button w-full py-3 rounded-xl text-white bg-red-500/30 hover:bg-red-500/50"
                    >
                      Confirm Emergency
                    </button>
                    <button
                      onClick={handleSOSCancel}
                      className="glass-button w-full py-3 rounded-xl text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {sosStatus === 'sending' && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-400 border-t-transparent mx-auto mb-4" />
                  <p className="text-primary-urban">Sending SOS...</p>
                  <p className="text-secondary-urban text-sm mt-2">Please wait</p>
                </div>
              )}

              {sosStatus === 'success' && (
                <div className="text-center py-6">
                  <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                  <p className="text-primary-urban text-lg mb-2">SOS Sent Successfully!</p>
                  <p className="text-green-400 text-sm">{sosMessage}</p>
                </div>
              )}

              {sosStatus === 'error' && (
                <div className="text-center py-6">
                  <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                  <p className="text-primary-urban text-lg mb-2">Error</p>
                  <p className="text-red-400 text-sm mb-4">{sosMessage}</p>
                  <button
                    onClick={handleSOSCancel}
                    className="glass-button w-full py-3 rounded-xl text-white"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showNavigationMap && activeDelivery && userLocation && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
            <div className="w-full h-full max-w-7xl max-h-[90vh] bg-gray-900 rounded-3xl overflow-hidden flex flex-col">
              <div className="p-4 glass-card-strong flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleCloseNavigationMap}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <ArrowLeft className="w-6 h-6 text-white" />
                  </button>
                  <h2 className="text-2xl text-primary-urban">Navigation</h2>
                </div>
                <div className="flex items-center gap-6">
                  {routeInfo && (
                    <>
                      <div className="flex items-center gap-2">
                        <Route className="w-5 h-5 text-cyan-400" />
                        <span className="text-white">{routeInfo.distance} km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-cyan-400" />
                        <span className="text-white">{routeInfo.duration} min</span>
                      </div>
                    </>
                  )}
                  {isRouteLoading && (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-cyan-400 border-t-transparent" />
                      <span className="text-cyan-400">Loading route...</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 relative">
                {isClient && mapCenter && isGoogleLoaded && (
                  <GoogleMap
                    center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                    zoom={14}
                    mapContainerClassName="h-full w-full"
                    options={{
                      streetViewControl: false,
                      mapTypeControl: false,
                      fullscreenControl: false,
                    }}
                  >
                    {userLocation && (
                      <MarkerF
                        position={{ lat: userLocation.lat, lng: userLocation.lng }}
                        title={`Your Current Location | Battery: ${vehicle?.battery ?? 'N/A'}%`}
                        icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/747/747310.png', 22)}
                      />
                    )}

                    <MarkerF
                      position={{ lat: activeDelivery.drop_lat, lng: activeDelivery.drop_lng }}
                      title={`Delivery Destination | Packages: ${activeDelivery.packages} | Priority: ${activeDelivery.priority}`}
                      icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/484/484167.png', 22)}
                    />

                    {routeInfo && routeInfo.coordinates.length > 0 && (
                      <PolylineF
                        path={routeInfo.coordinates.map((point) => ({ lat: point[0], lng: point[1] }))}
                        options={{
                          strokeColor: '#00ffff',
                          strokeOpacity: 0.8,
                          strokeWeight: 5,
                          icons:
                            routeInfo.source === 'fallback'
                              ? [
                                  {
                                    icon: {
                                      path: 'M 0,-1 0,1',
                                      strokeOpacity: 1,
                                      scale: 4,
                                    },
                                    offset: '0',
                                    repeat: '20px',
                                  },
                                ]
                              : undefined,
                        }}
                      />
                    )}
                  </GoogleMap>
                )}
                {isClient && mapCenter && !isGoogleLoaded && (
                  <div className="h-full w-full flex items-center justify-center text-sm text-white/70 bg-black/20">
                    Loading Google Map...
                  </div>
                )}
                {routeWarning && (
                  <div className="absolute top-3 left-3 z-[1000] p-2 rounded-lg bg-yellow-500/90 text-white text-xs">
                    {routeWarning}
                  </div>
                )}
              </div>

              <div className="p-4 glass-card-strong flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-500" />
                    <span className="text-white text-sm">Your Location</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-red-500" />
                    <span className="text-white text-sm">Destination</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleCloseNavigationMap}
                    className="glass-button px-6 py-2 rounded-lg text-white"
                  >
                    Back to Dashboard
                  </button>
                  {routeInfo && (
                    <button
                      onClick={() => fetchRouteForDelivery()}
                      className="glass-button px-6 py-2 rounded-lg text-white bg-cyan-500/30 hover:bg-cyan-500/50"
                      disabled={isRouteLoading}
                    >
                      <Gauge className="w-4 h-4 mr-2 inline" />
                      Refresh Route
                    </button>
                  )}
                </div>
              </div>
              {routeInfo?.source === 'road' && routeInfo.steps.length > 0 && (
                <div className="p-4 glass-card-strong border-t border-white/10 max-h-48 overflow-auto">
                  <p className="text-primary-urban mb-2">Turn-by-turn</p>
                  <div className="space-y-1">
                    {routeInfo.steps.slice(0, 12).map((step, idx) => (
                      <p key={`${idx}-${step.instruction}`} className="text-sm text-secondary-urban">
                        {idx + 1}. {step.instruction} ({step.distance} km, {step.duration} min)
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <KPICard
            icon={Package}
            label="Today's Deliveries"
            value={performance.completedToday.toString()}
            change={`${pendingJobs.length} remaining`}
            status="active"
          />
          <KPICard
            icon={CheckCircle}
            label="Delivered Today"
            value={performance.completedToday}
            change="Synced from delivery status"
            trend="up"
          />
          <KPICard
            icon={Truck}
            label="Distance Covered"
            value={`${performance.distanceTraveled} km`}
            change="Based on deliveries"
            status="warning"
          />
          <KPICard
            icon={Trophy}
            label="On-time Rate"
            value={`${performance.onTimeRate}%`}
            change="Rolling average"
            trend="up"
            status="active"
          />
        </div>

        <GlassCard className="mb-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 md:grid-cols-7 gap-2 mb-6 bg-transparent">
              <TabsTrigger
                value="jobs"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <Package className="w-4 h-4 mr-2" />
                Today's Jobs
              </TabsTrigger>
              <TabsTrigger
                value="navigation"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <Navigation className="w-4 h-4 mr-2" />
                Navigate
              </TabsTrigger>
              <TabsTrigger
                value="hub"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <QrCode className="w-4 h-4 mr-2" />
                Hub Actions
              </TabsTrigger>
              <TabsTrigger
                value="pod"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <Camera className="w-4 h-4 mr-2" />
                Proof of Delivery
              </TabsTrigger>
              <TabsTrigger
                value="earnings"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <DollarSign className="w-4 h-4 mr-2" />
                Earnings
              </TabsTrigger>
              <TabsTrigger
                value="vehicle"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <Battery className="w-4 h-4 mr-2" />
                Vehicle
              </TabsTrigger>
              <TabsTrigger
                value="deliveries"
                className="glass-button data-[state=active]:glass-card-strong data-[state=active]:glow-cyan"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Completed
              </TabsTrigger>
            </TabsList>

            <TabsContent value="jobs" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl text-primary-urban">Delivery Timeline</h3>
                <span className="text-secondary-urban text-sm">{pendingJobs.length} jobs scheduled</span>
              </div>
              {featuredJob && (
                <div className="glass-card p-4 rounded-xl border-l-4 border-cyan-400 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-cyan-400 font-medium">Featured Job</p>
                      <p className="text-white">Order #{featuredJob.id.slice(0, 8)}</p>
                    </div>
                    {featuredJob.status === 'assigned' &&
                    (!featuredJob.driver_id || featuredJob.driver_id === driverUuid) ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAccept(featuredJob.id)}
                          className="glass-button px-4 py-2 rounded-lg text-white bg-green-500/30 hover:bg-green-500/50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleReject(featuredJob.id)}
                          className="glass-button px-4 py-2 rounded-lg text-white bg-red-500/30 hover:bg-red-500/50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : featuredJob.status === 'assigned' &&
                      featuredJob.driver_id &&
                      featuredJob.driver_id !== driverUuid ? (
                      <span className="text-xs text-yellow-300">Already accepted by another driver.</span>
                    ) : featuredJob.status === 'accepted' || featuredJob.status === 'in_transit' ? (
                      <button
                        onClick={() => openNavigationForJob(featuredJob, true)}
                        className="glass-button px-4 py-2 rounded-lg text-white"
                      >
                        Navigate
                      </button>
                    ) : (
                      <span className="text-xs text-secondary-urban">No action available</span>
                    )}
                  </div>
                </div>
              )}
              {pendingJobs.map((job, index) => (
                <div key={job.id} className="glass-card p-4 rounded-xl relative">
                  {index !== pendingJobs.length - 1 && (
                    <div className="absolute left-6 top-16 w-0.5 h-12 bg-white/20" />
                  )}
                  <div className="flex items-start gap-4">
                    {(() => {
                      const jobStatus = String(job.status || '').toLowerCase();
                      return (
                        <>
                    <div
                      className={`p-2 rounded-full ${
                        jobStatus === 'completed'
                          ? 'bg-green-500/20'
                          : jobStatus === 'in_transit'
                          ? 'bg-cyan-500/20'
                          : jobStatus === 'accepted'
                          ? 'bg-purple-500/20'
                          : 'bg-white/10'
                      }`}
                    >
                      {jobStatus === 'completed' && <CheckCircle className="w-5 h-5 text-green-300" />}
                      {jobStatus === 'in_transit' && <Truck className="w-5 h-5 text-cyan-300" />}
                      {jobStatus === 'accepted' && <Package className="w-5 h-5 text-purple-300" />}
                      {jobStatus === 'assigned' && <Clock className="w-5 h-5 text-white/60" />}
                      {jobStatus === 'picked_up' && <Package className="w-5 h-5 text-yellow-300" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-primary-urban mb-1">Delivery #{job.id.slice(0, 8)}</p>
                          <p className="text-muted-urban text-sm">
                            {formatCoord(job.pickup_lat)},{formatCoord(job.pickup_lng)}{' '}
                            {formatCoord(job.drop_lat)},{formatCoord(job.drop_lng)}
                          </p>
                        </div>
                        <span className="text-secondary-urban text-sm">{job.estimated_arrival}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-secondary-urban">
                        <span>{job.packages} packages</span>
                        <span
                          className={`capitalize px-2 py-1 rounded ${
                            jobStatus === 'completed'
                              ? 'bg-green-500/20 text-green-300'
                              : jobStatus === 'in_transit'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : jobStatus === 'accepted'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-white/10'
                          }`}
                        >
                          {jobStatus.replace('_', ' ')}
                        </span>
                      </div>
                      {jobStatus === 'assigned' &&
                        (!job.driver_id || job.driver_id === driverUuid) && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleAccept(job.id)}
                            className="glass-button px-4 py-2 rounded-lg text-white text-sm bg-green-500/30 hover:bg-green-500/50"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleReject(job.id)}
                            className="glass-button px-4 py-2 rounded-lg text-white text-sm bg-red-500/30 hover:bg-red-500/50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {jobStatus === 'assigned' &&
                        job.driver_id &&
                        job.driver_id !== driverUuid && (
                          <p className="mt-3 text-xs text-yellow-300">
                            Already accepted by another driver.
                          </p>
                        )}
                      {(jobStatus === 'accepted' || jobStatus === 'in_transit') && (
                        <button
                          onClick={() => openNavigationForJob(job, true)}
                          className="glass-button mt-3 px-4 py-2 rounded-lg text-white text-sm"
                        >
                          Navigate
                        </button>
                      )}
                      {jobStatus === 'in_transit' && (
                        <button
                          onClick={() => handleCompleteDelivery(job.id)}
                          className="glass-button mt-3 px-4 py-2 rounded-lg text-white text-sm bg-green-500/30 hover:bg-green-500/50"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
              {pendingJobs.length === 0 && (
                <div className="text-center py-8 text-secondary-urban">
                  No pending deliveries. Waiting for new orders...
                </div>
              )}
            </TabsContent>

            <TabsContent value="navigation" className="space-y-4">
              <h3 className="text-xl text-primary-urban mb-4">Live Navigation</h3>
              {activeDelivery ? (
                <>
                  {isClient && (userLocation || vehicle) && isGoogleLoaded && (
                    <GoogleMap
                      center={{
                        lat: userLocation?.lat || vehicle?.lat || 12.9716,
                        lng: userLocation?.lng || vehicle?.lng || 77.5946,
                      }}
                      zoom={14}
                      mapContainerClassName="h-96 rounded-xl"
                      options={{
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: false,
                      }}
                    >
                      <MarkerF
                        position={{
                          lat: userLocation?.lat || vehicle?.lat || 12.9716,
                          lng: userLocation?.lng || vehicle?.lng || 77.5946,
                        }}
                        title={`Your vehicle | Battery: ${vehicle?.battery ?? 'N/A'}% | Status: ${vehicle?.status ?? 'unknown'}`}
                        icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/3095/3095583.png', 22)}
                      />

                      {routeInfo && routeInfo.coordinates.length > 0 && (
                        <PolylineF
                          path={routeInfo.coordinates.map((point) => ({ lat: point[0], lng: point[1] }))}
                          options={{
                            strokeColor: '#3b82f6',
                            strokeOpacity: 0.8,
                            strokeWeight: 5,
                            icons:
                              routeInfo.source === 'fallback'
                                ? [
                                    {
                                      icon: {
                                        path: 'M 0,-1 0,1',
                                        strokeOpacity: 1,
                                        scale: 4,
                                      },
                                      offset: '0',
                                      repeat: '20px',
                                    },
                                  ]
                                : undefined,
                          }}
                        />
                      )}

                      <MarkerF
                        position={{ lat: activeDelivery.drop_lat, lng: activeDelivery.drop_lng }}
                        title={`Drop point | Packages: ${activeDelivery.packages} | Priority: ${activeDelivery.priority}`}
                        icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/684/684908.png', 20)}
                      />

                      <MarkerF
                        position={{ lat: activeDelivery.pickup_lat, lng: activeDelivery.pickup_lng }}
                        title={`Pickup point | Packages: ${activeDelivery.packages}`}
                        icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/684/684908.png', 20)}
                      />

                      {chargingStations.map((s) => (
                        <MarkerF
                          key={s.id}
                          position={{ lat: s.lat, lng: s.lng }}
                          title={`${s.name} | ${s.available ? 'Available' : 'Occupied'}`}
                          icon={buildMarkerIcon('https://cdn-icons-png.flaticon.com/512/1043/1043689.png', 18)}
                        />
                      ))}

                      {zones
                        .filter((z) => z.restricted)
                        .map((zone) => (
                          <CircleF
                            key={zone.id}
                            center={{ lat: zone.lat, lng: zone.lng }}
                            radius={zone.radius}
                            options={{ strokeColor: 'red', fillColor: 'red', fillOpacity: 0.2 }}
                          />
                        ))}

                      {aqiReadings
                        .filter((a) => a.aqi > 150)
                        .map((a) => (
                          <CircleF
                            key={a.id}
                            center={{ lat: a.lat, lng: a.lng }}
                            radius={2000}
                            options={{ strokeColor: 'orange', fillColor: 'orange', fillOpacity: 0.3 }}
                          />
                        ))}
                    </GoogleMap>
                  )}
                  {isClient && (userLocation || vehicle) && !isGoogleLoaded && (
                    <div className="h-96 rounded-xl flex items-center justify-center text-sm text-white/70 bg-black/20">
                      Loading Google Map...
                    </div>
                  )}

                  {routeInfo && (
                    <div className="grid grid-cols-3 gap-4 mt-4">
                      <div className="glass-card p-4 rounded-xl text-center">
                        <Clock className="w-6 h-6 text-cyan-glow mx-auto mb-2" />
                        <p className="text-primary-urban text-lg">{routeInfo.duration} min</p>
                        <p className="text-muted-urban text-sm">ETA</p>
                      </div>
                      <div className="glass-card p-4 rounded-xl text-center">
                        <MapPin className="w-6 h-6 text-cyan-glow mx-auto mb-2" />
                        <p className="text-primary-urban text-lg">{routeInfo.distance} km</p>
                        <p className="text-muted-urban text-sm">Distance</p>
                      </div>
                      <div className="glass-card p-4 rounded-xl text-center">
                        <button
                          onClick={handleOpenNavigationMap}
                          className="glass-button w-full py-3 rounded-lg text-white bg-cyan-500/30 hover:bg-cyan-500/50"
                        >
                          Open Full Map
                        </button>
                      </div>
                    </div>
                  )}
                  {routeWarning && (
                    <div className="mt-3 p-3 rounded-lg bg-yellow-500/20 text-yellow-100 text-sm">
                      {routeWarning}
                    </div>
                  )}
                  {routeInfo?.source === 'road' && routeInfo.steps.length > 0 && (
                    <GlassCard className="mt-4">
                      <p className="text-primary-urban mb-3">Turn-by-turn Directions</p>
                      <div className="space-y-2 max-h-56 overflow-auto">
                        {routeInfo.steps.slice(0, 10).map((step, idx) => (
                          <div key={`${idx}-${step.instruction}`} className="text-sm text-secondary-urban">
                            {idx + 1}. {step.instruction} ({step.distance} km, {step.duration} min)
                          </div>
                        ))}
                      </div>
                    </GlassCard>
                  )}
                </>
              ) : (
                <div className="text-center py-12 glass-card p-8">
                  <Navigation className="w-16 h-16 text-cyan-400 mx-auto mb-4" />
                  <p className="text-primary-urban text-xl mb-2">No Active Delivery</p>
                  <p className="text-secondary-urban">Accept an order to start navigation</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="hub" className="space-y-4">
              <h3 className="text-xl text-primary-urban mb-4">Hub Operations</h3>
              <div className="glass-card p-8 rounded-xl text-center">
                <QrCode className="w-24 h-24 text-cyan-glow mx-auto mb-4" />
                <p className="text-primary-urban text-xl mb-2">Scan Package QR Code</p>
                <p className="text-secondary-urban mb-6">Scan to pickup or deliver packages at hub</p>
                <button className="glass-button px-8 py-3 rounded-xl text-white">Open Scanner</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button className="glass-card p-6 rounded-xl text-center hover-lift">
                  <Package className="w-12 h-12 text-cyan-glow mx-auto mb-2" />
                  <p className="text-primary-urban">Pickup Packages</p>
                </button>
                <button className="glass-card p-6 rounded-xl text-center hover-lift">
                  <CheckCircle className="w-12 h-12 text-cyan-glow mx-auto mb-2" />
                  <p className="text-primary-urban">Mark Delivered</p>
                </button>
              </div>
            </TabsContent>

            <TabsContent value="pod" className="space-y-4">
              <h3 className="text-xl text-primary-urban mb-4">Proof of Delivery</h3>

              {activeDelivery ? (
                <div className="space-y-4">
                  <GlassCard>
                    <p className="text-secondary-urban mb-3">Step 1: OTP Confirmation</p>
                    <input
                      type="text"
                      maxLength={6}
                      value={podOtp}
                      onChange={(e) => setPodOtp(e.target.value)}
                      placeholder="Enter 6-digit OTP"
                      className="glass-input w-full px-4 py-3 rounded-xl text-center tracking-widest"
                    />
                  </GlassCard>

                  <GlassCard>
                    <p className="text-secondary-urban mb-3">Step 2: Photo Evidence</p>
                    <label className="glass-input rounded-xl h-48 flex items-center justify-center cursor-pointer hover-lift">
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoCapture}
                        hidden
                      />
                      <div className="text-center">
                        <Camera className="w-12 h-12 text-white/60 mx-auto mb-2" />
                        <p className="text-secondary-urban">
                          {podPhoto ? 'Photo Captured' : 'Tap to capture photo'}
                        </p>
                      </div>
                    </label>
                  </GlassCard>

                  <GlassCard>
                    <p className="text-secondary-urban mb-3">Step 3: Signature</p>
                    <canvas
                      ref={signatureCanvasRef}
                      width={350}
                      height={150}
                      className="bg-white rounded-xl w-full"
                      onMouseDown={startDraw}
                      onMouseUp={endDraw}
                      onMouseMove={draw}
                      onTouchStart={startDraw}
                      onTouchEnd={endDraw}
                      onTouchMove={draw}
                    />
                    <button
                      onClick={saveSignatureBlob}
                      className="glass-button mt-3 px-4 py-2 rounded-lg text-white"
                    >
                      Save Signature
                    </button>
                  </GlassCard>

                  <button
                    onClick={handleSubmitPOD}
                    disabled={podLoading}
                    className="glass-button w-full py-4 rounded-xl text-white text-lg glow-cyan"
                  >
                    {podLoading ? 'Submitting...' : 'Submit Proof of Delivery'}
                  </button>

                  {podSuccess && (
                    <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-green-600 px-6 py-4 rounded-xl flex items-center gap-3 animate-bounce">
                      <CheckCircle className="w-6 h-6 text-white" />
                      <span className="text-white font-bold">SUBMITTED SUCCESSFULLY</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 glass-card p-8">
                  <Camera className="w-16 h-16 text-cyan-400 mx-auto mb-4" />
                  <p className="text-primary-urban text-xl mb-2">No Active Delivery</p>
                  <p className="text-secondary-urban">Accept an order to submit proof</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="earnings" className="space-y-4">
              <h3 className="text-xl text-primary-urban mb-4">Earnings & Performance</h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <GlassCard>
                  <p className="text-muted-urban mb-2">Distance Covered</p>
                  <p className="text-3xl text-primary-urban">{performance.distanceTraveled} km</p>
                  <p className="text-secondary-urban text-sm mt-1">Based on assigned delivery routes</p>
                </GlassCard>
                <GlassCard>
                  <p className="text-muted-urban mb-2">Carbon Saved</p>
                  <p className="text-3xl text-primary-urban">{performance.carbonSaved} kg</p>
                  <p className="text-secondary-urban text-sm mt-1">Estimated CO2 offset</p>
                </GlassCard>
              </div>
            </TabsContent>

            <TabsContent value="vehicle" className="space-y-4">
              <h3 className="text-xl text-primary-urban mb-4">Vehicle Health</h3>
              <GlassCard>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-secondary-urban">Battery Level</p>
                  <p className={`text-2xl ${batteryColor(vehicle?.battery || 0)}`}>
                    {vehicle?.battery ?? 0}%
                  </p>
                </div>
                <div className="w-full bg-white/10 rounded-full h-4 mb-2">
                  <div
                    className="h-4 rounded-full transition-all duration-500"
                    style={{
                      width: `${vehicle?.battery || 0}%`,
                      backgroundColor:
                        (vehicle?.battery || 0) > 50
                          ? '#22c55e'
                          : (vehicle?.battery || 0) > 20
                          ? '#eab308'
                          : '#ef4444',
                    }}
                  />
                </div>
                <p className="text-muted-urban text-sm">
                  Estimated range: {Math.round(((vehicle?.battery || 0) / 100) * 75)} km
                </p>
              </GlassCard>

              <h4 className="text-lg text-secondary-urban mb-3">Nearby Charging Stations</h4>
              <div className="space-y-3">
                {chargingStations.length === 0 && (
                  <div className="text-secondary-urban text-sm">No charging stations available.</div>
                )}
                {chargingStations.map((station) => (
                  <div key={station.id} className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-primary-urban">{station.name}</p>
                      <span className="text-cyan-glow text-sm">
                        {vehicle &&
                          `${(getDistance(vehicle.lat, vehicle.lng, station.lat, station.lng) / 1000).toFixed(1)} km`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-muted-urban text-sm">
                        {station.available ? 'Available' : 'Occupied'}
                      </p>
                      <button
                        onClick={() => setActiveTab('navigation')}
                        className="glass-button px-4 py-1 rounded-lg text-white text-sm"
                      >
                        Navigate
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <GlassCard className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-green-400 text-lg">Eco Score</span>
                  <span className="text-2xl font-bold text-white">{ecoScore}</span>
                </div>
                {nearestChargingStation() && (
                  <p className="text-muted-urban text-sm mt-2">
                    Nearest station: {nearestChargingStation()?.station.name} (
                      {((nearestChargingStation()?.distance || 0) / 1000).toFixed(1)}
                    km)
                  </p>
                )}
              </GlassCard>
            </TabsContent>

            <TabsContent value="deliveries" className="space-y-4">
              <GlassCard className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-xl text-primary-urban">Delivery Performance</h3>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                      <XAxis dataKey="date" stroke="#ffffff60" />
                      <YAxis stroke="#ffffff60" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1a1a2e',
                          border: '1px solid #00ffff20',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="deliveries" fill="#00ffff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </GlassCard>

              <h3 className="text-xl text-primary-urban mb-4">Today's Completed Deliveries</h3>
              {completedDeliveries.length > 0 ? (
                <div className="space-y-3">
                  {completedDeliveries.map((delivery) => (
                    <div key={delivery.id} className="glass-card p-4 rounded-xl">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-primary-urban font-medium">Delivery #{delivery.id.slice(0, 8)}</p>
                          <p className="text-muted-urban text-sm mt-1">{delivery.delivery_address}</p>
                          <p className="text-secondary-urban text-xs mt-2">{delivery.packages} packages</p>
                        </div>
                        <div className="text-right">
                          <span className="text-cyan-400 text-sm">{delivery.completed_at}</span>
                          <CheckCircle className="w-5 h-5 text-green-400 mt-2 ml-auto" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="glass-card p-4 rounded-xl mt-4">
                    <p className="text-primary-urban text-center">
                      Total: {completedDeliveries.length} deliveries completed today
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-secondary-urban">No deliveries completed yet today</div>
              )}
            </TabsContent>
          </Tabs>
        </GlassCard>

        <div className="fixed bottom-6 right-6">
          <button
            onClick={handleSOSClick}
            className="glass-card-strong p-6 rounded-full glow-cyan-strong hover:scale-110 transition-transform"
          >
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
