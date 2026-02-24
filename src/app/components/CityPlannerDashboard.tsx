import { useEffect, useMemo, useState } from 'react';
import { CircleF, GoogleMap, InfoWindowF, useJsApiLoader } from '@react-google-maps/api';
import { Activity, AlertTriangle, CheckCircle, Construction, TrendingUp } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';

const AREA_COORDS: Record<string, [number, number]> = {
  'T. Nagar': [13.0418, 80.2341],
  Guindy: [13.01, 80.22],
  'Anna Nagar': [13.085, 80.2101],
  Adyar: [13.0067, 80.257],
  'Marina Beach': [13.05, 80.2824],
  Velachery: [12.9791, 80.2221],
  'Perambur High Road': [13.1176, 80.2306],
  Saidapet: [13.0213, 80.2235],
  'Egmore - Chintadripet Corridor': [13.0807, 80.2665],
};

type Zone = {
  id: string;
  name: string;
  density: 'low' | 'medium' | 'high';
};

type AQI = {
  id: string;
  area: string;
  aqi: number;
};

type Operator = {
  id: string;
  name: string;
  vehicles: number;
  compliance: number;
};

type RoadAlert = {
  id: string;
  title: string;
  category: 'Bridge Construction' | 'Flyover Construction' | 'Railway Corridor Work' | 'Road Widening';
  area: string;
  affectedStretch: string;
  lanesClosed: number;
  severity: 'low' | 'medium' | 'high';
  congestionIndex: number;
  etaDelayMin: number;
  phase: 'Planned' | 'Ongoing';
  expectedCompletion: string;
  lastReportedAt: string;
};

type RowLike = Record<string, unknown>;

const densityColor = (density: string) =>
  density === 'high' ? 'red' : density === 'medium' ? 'orange' : 'green';

const densityRadius = (density: string) =>
  density === 'high' ? 24 : density === 'medium' ? 18 : 12;

const aqiLevel = (aqi: number) => {
  if (aqi <= 100) return { label: 'GOOD', color: 'text-green-400' };
  if (aqi <= 150) return { label: 'MODERATE', color: 'text-orange-400' };
  return { label: 'POOR', color: 'text-red-400' };
};

const ROAD_ALERTS_SEED: RoadAlert[] = [
  {
    id: 'rb-001',
    title: 'Cloverleaf Flyover Pile Foundation',
    category: 'Flyover Construction',
    area: 'Guindy',
    affectedStretch: 'GST Road Junction to Kathipara Loop',
    lanesClosed: 2,
    severity: 'high',
    congestionIndex: 88,
    etaDelayMin: 32,
    phase: 'Ongoing',
    expectedCompletion: '2026-07-30',
    lastReportedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
  {
    id: 'rb-002',
    title: 'Rail Underpass Reinforcement',
    category: 'Railway Corridor Work',
    area: 'Perambur High Road',
    affectedStretch: 'Perambur Barracks Road to Paper Mills Road',
    lanesClosed: 1,
    severity: 'medium',
    congestionIndex: 72,
    etaDelayMin: 19,
    phase: 'Ongoing',
    expectedCompletion: '2026-05-18',
    lastReportedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  },
  {
    id: 'rb-003',
    title: 'Canal Bridge Deck Casting',
    category: 'Bridge Construction',
    area: 'Adyar',
    affectedStretch: 'Sardar Patel Road Service Lane',
    lanesClosed: 1,
    severity: 'medium',
    congestionIndex: 67,
    etaDelayMin: 14,
    phase: 'Ongoing',
    expectedCompletion: '2026-06-05',
    lastReportedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'rb-004',
    title: 'Smart Corridor Utility Ducting',
    category: 'Road Widening',
    area: 'Saidapet',
    affectedStretch: 'Anna Salai Slip Road',
    lanesClosed: 1,
    severity: 'low',
    congestionIndex: 58,
    etaDelayMin: 9,
    phase: 'Planned',
    expectedCompletion: '2026-04-20',
    lastReportedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: 'rb-005',
    title: 'Drain-Top Bridge Span Launch',
    category: 'Bridge Construction',
    area: 'Egmore - Chintadripet Corridor',
    affectedStretch: 'Pantheon Road to EVR Salai',
    lanesClosed: 2,
    severity: 'high',
    congestionIndex: 83,
    etaDelayMin: 27,
    phase: 'Ongoing',
    expectedCompletion: '2026-08-11',
    lastReportedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
];

const severityPillClass = (severity: RoadAlert['severity']) => {
  if (severity === 'high') return 'bg-red-500/20 text-red-300 border-red-300/40';
  if (severity === 'medium') return 'bg-orange-500/20 text-orange-300 border-orange-300/40';
  return 'bg-cyan-500/20 text-cyan-200 border-cyan-200/40';
};

const congestionToneClass = (index: number) => {
  if (index >= 85) return 'text-red-300';
  if (index >= 70) return 'text-orange-300';
  return 'text-cyan-200';
};

const constructionCircleColor = (severity: RoadAlert['severity']) => {
  if (severity === 'high') return '#ff5b5b';
  if (severity === 'medium') return '#f5a623';
  return '#26d0ce';
};

const formatMinutesAgo = (isoTime: string, nowMs: number) => {
  const diffMin = Math.max(0, Math.floor((nowMs - new Date(isoTime).getTime()) / 60000));
  if (diffMin < 1) return 'updated just now';
  if (diffMin === 1) return 'updated 1 min ago';
  return `updated ${diffMin} mins ago`;
};

export function CityPlannerDashboard() {
  const googleMapsApiKey = GOOGLE_MAPS_API_KEY;
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps',
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
  });

  const [zones, setZones] = useState<Zone[]>([]);
  const [aqi, setAqi] = useState<AQI[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [roadAlerts, setRoadAlerts] = useState<RoadAlert[]>(ROAD_ALERTS_SEED);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isClient, setIsClient] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);

    const loadData = async () => {
      setError(null);

      const [zonesRes, aqiRes, operatorsRes] = await Promise.all([
        supabase.from('freight_zones').select('*'),
        supabase.from('aqi_readings').select('*'),
        supabase.from('operator_compliance').select('*'),
      ]);

      if (zonesRes.error || aqiRes.error || operatorsRes.error) {
        setError(
          zonesRes.error?.message ||
            aqiRes.error?.message ||
            operatorsRes.error?.message ||
            'Failed to load dashboard data'
        );
        setZones([]);
        setAqi([]);
        setOperators([]);
        return;
      }

      setZones((zonesRes.data || []) as Zone[]);
      setAqi((aqiRes.data || []) as AQI[]);
      setOperators((operatorsRes.data || []) as Operator[]);
    };

    void loadData();

    const applyUpsert = <T extends { id: string }>(
      prev: T[],
      mapped: T,
      eventType: string
    ): T[] => {
      if (eventType === 'DELETE') {
        return prev.filter((item) => item.id !== mapped.id);
      }
      const exists = prev.some((item) => item.id === mapped.id);
      if (!exists) return [mapped, ...prev];
      return prev.map((item) => (item.id === mapped.id ? mapped : item));
    };

    const channel = supabase
      .channel('city-planner-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freight_zones' }, (payload) => {
        const row = (payload.new || payload.old) as RowLike;
        const mapped: Zone = {
          id: String(row.id ?? ''),
          name: String(row.name ?? row.zone ?? ''),
          density: String(row.density ?? row.activity_level ?? 'low') as Zone['density'],
        };
        if (!mapped.id) return;
        setZones((prev) => applyUpsert(prev, mapped, payload.eventType));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aqi_readings' }, (payload) => {
        const row = (payload.new || payload.old) as RowLike;
        const mapped: AQI = {
          id: String(row.id ?? ''),
          area: String(row.area ?? ''),
          aqi: Number(row.aqi ?? 0),
        };
        if (!mapped.id) return;
        setAqi((prev) => applyUpsert(prev, mapped, payload.eventType));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operator_compliance' }, (payload) => {
        const row = (payload.new || payload.old) as RowLike;
        const mapped: Operator = {
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          vehicles: Number(row.vehicles ?? 0),
          compliance: Number(row.compliance ?? 0),
        };
        if (!mapped.id) return;
        setOperators((prev) => applyUpsert(prev, mapped, payload.eventType));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
      setRoadAlerts((prev) =>
        prev.map((alert) => {
          const jitter = Math.round((Math.random() - 0.5) * 10);
          const nextCongestion = Math.min(98, Math.max(45, alert.congestionIndex + jitter));
          const nextDelay = Math.max(
            6,
            Math.round(nextCongestion * 0.3) + (alert.severity === 'high' ? 7 : alert.severity === 'medium' ? 4 : 1)
          );
          const shouldRefreshTimestamp = Math.random() > 0.35;
          return {
            ...alert,
            congestionIndex: nextCongestion,
            etaDelayMin: nextDelay,
            lastReportedAt: shouldRefreshTimestamp ? new Date().toISOString() : alert.lastReportedAt,
          };
        })
      );
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  const activeRoadAlerts = useMemo(
    () => roadAlerts.filter((alert) => alert.phase === 'Ongoing'),
    [roadAlerts]
  );

  const severeRoadAlerts = useMemo(
    () => roadAlerts.filter((alert) => alert.severity === 'high').length,
    [roadAlerts]
  );

  return (
    <div className="min-h-screen urbanflow-gradient p-6">
      <div className="max-w-7xl mx-auto">
        <DashboardHeader
          title="City Planner Dashboard"
          subtitle="Live Urban Freight Monitoring"
        />

        {error && (
          <GlassCard className="mb-6">
            <p className="text-red-300 text-sm">{error}</p>
          </GlassCard>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
          <KPICard icon={Activity} label="Freight Zones" value={zones.length.toString()} />
          <KPICard icon={TrendingUp} label="AQI Areas" value={aqi.length.toString()} />
          <KPICard
            icon={CheckCircle}
            label="Avg Compliance"
            value={
              operators.length
                ? `${Math.round(
                    operators.reduce((sum, op) => sum + op.compliance, 0) /
                      operators.length
                  )}%`
                : 'N/A'
            }
          />
          <KPICard
            icon={AlertTriangle}
            label="Road Blockage Alerts"
            value={activeRoadAlerts.length.toString()}
            change={`${severeRoadAlerts} high priority`}
            trend={severeRoadAlerts > 0 ? 'down' : 'neutral'}
            status={severeRoadAlerts > 0 ? 'warning' : 'active'}
          />
        </div>

        <GlassCard className="mb-6">
          <h2 className="text-xl text-primary-urban mb-4">
            Live Freight Density Map
          </h2>

          {isClient && isGoogleLoaded && (
            <GoogleMap
              center={{ lat: 13.0827, lng: 80.2707 }}
              zoom={11}
              mapContainerClassName="h-96 rounded-xl"
              options={{
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
                mapId: GOOGLE_MAP_ID || undefined,
              }}
            >
              {zones.map((zone) => {
                const coords = AREA_COORDS[zone.name];
                if (!coords) return null;

                return (
                  <CircleF
                    key={zone.id}
                    center={{ lat: coords[0], lng: coords[1] }}
                    radius={densityRadius(zone.density) * 100}
                    options={{
                      strokeColor: densityColor(zone.density),
                      fillColor: densityColor(zone.density),
                      fillOpacity: 0.45,
                    }}
                  >
                    <InfoWindowF position={{ lat: coords[0], lng: coords[1] }}>
                      <div>
                        <strong>{zone.name}</strong>
                        <br />
                        Density: {zone.density}
                      </div>
                    </InfoWindowF>
                  </CircleF>
                );
              })}
              {roadAlerts.map((alert) => {
                const coords = AREA_COORDS[alert.area];
                if (!coords) return null;
                return (
                  <CircleF
                    key={alert.id}
                    center={{ lat: coords[0], lng: coords[1] }}
                    radius={220 + alert.lanesClosed * 70}
                    options={{
                      strokeColor: constructionCircleColor(alert.severity),
                      strokeOpacity: 0.9,
                      strokeWeight: 2,
                      fillColor: constructionCircleColor(alert.severity),
                      fillOpacity: 0.2,
                    }}
                  />
                );
              })}
            </GoogleMap>
          )}
          {isClient && !isGoogleLoaded && (
            <div className="h-96 rounded-xl flex items-center justify-center text-sm text-white/70 bg-black/20">
              Loading Google Map...
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-white/80">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
              High-impact construction
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-orange-300 inline-block" />
              Medium-impact construction
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-cyan-300 inline-block" />
              Low-impact construction
            </div>
          </div>
        </GlassCard>

        <GlassCard className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl text-primary-urban">
                Road Blockage Alerts
              </h2>
              <p className="text-sm text-muted-urban">
                Live construction disruptions affecting urban traffic corridors
              </p>
            </div>
            <div className="glass-card rounded-xl px-3 py-2 text-xs text-cyan-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse inline-block" />
              Auto-refresh every 15s
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {roadAlerts
              .slice()
              .sort((a, b) => b.congestionIndex - a.congestionIndex)
              .map((alert) => (
                <div key={alert.id} className="glass-card rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="glass-card rounded-lg p-2">
                        <Construction className="w-4 h-4 text-cyan-glow" />
                      </div>
                      <div>
                        <p className="text-white font-semibold">{alert.title}</p>
                        <p className="text-xs text-muted-urban">{alert.category}</p>
                      </div>
                    </div>
                    <span className={`text-[11px] px-2 py-1 rounded-full border uppercase tracking-wide ${severityPillClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 text-sm">
                    <p className="text-secondary-urban">
                      <span className="text-muted-urban">Area: </span>
                      {alert.area}
                    </p>
                    <p className="text-secondary-urban">
                      <span className="text-muted-urban">Phase: </span>
                      {alert.phase}
                    </p>
                    <p className="text-secondary-urban">
                      <span className="text-muted-urban">Affected: </span>
                      {alert.affectedStretch}
                    </p>
                    <p className="text-secondary-urban">
                      <span className="text-muted-urban">Lanes Closed: </span>
                      {alert.lanesClosed}
                    </p>
                  </div>

                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-urban">Congestion Index</span>
                      <span className={`font-semibold ${congestionToneClass(alert.congestionIndex)}`}>
                        {alert.congestionIndex}/100
                      </span>
                    </div>
                    <div className="w-full h-2 bg-black/25 rounded-full">
                      <div
                        className="h-2 rounded-full bg-white/90"
                        style={{ width: `${alert.congestionIndex}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <p className="text-orange-200">
                      Delay: +{alert.etaDelayMin} min
                    </p>
                    <p className="text-muted-urban">
                      ETA clear by {new Date(alert.expectedCompletion).toLocaleDateString()}
                    </p>
                    <p className="text-cyan-200">
                      {formatMinutesAgo(alert.lastReportedAt, nowMs)}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GlassCard>
            <h2 className="text-xl text-primary-urban mb-4">
              Air Quality Index
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {aqi.map((a) => {
                const level = aqiLevel(a.aqi);
                return (
                  <div key={a.id} className="glass-card p-4 rounded-xl">
                    <p className="text-sm text-muted-urban">{a.area}</p>
                    <p className="text-4xl font-bold text-white">
                      {a.aqi}
                    </p>
                    <p className={`text-xs uppercase ${level.color}`}>
                      {level.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="text-xl text-primary-urban mb-4">
              Operator Compliance
            </h2>

            <div className="space-y-4">
              {operators.map((op) => (
                <div key={op.id} className="glass-card p-4 rounded-xl">
                  <div className="flex justify-between mb-2">
                    <span>{op.name}</span>
                    <span className="font-semibold">
                      {op.compliance}%
                    </span>
                  </div>

                  <div className="w-full h-3 bg-black/20 rounded">
                    <div
                      className="h-3 rounded bg-white"
                      style={{ width: `${op.compliance}%` }}
                    />
                  </div>

                  <p className="text-xs text-muted-urban mt-1">
                    Vehicles: {op.vehicles}
                  </p>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
