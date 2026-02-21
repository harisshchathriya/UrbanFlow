import { useEffect, useState } from 'react';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { supabase } from '../../services/supabaseClient';
import { CircleF, GoogleMap, InfoWindowF, useJsApiLoader } from '@react-google-maps/api';
import { Activity, TrendingUp, CheckCircle } from 'lucide-react';

const ZONE_COORDS: Record<string, [number, number]> = {
  'T. Nagar': [13.0418, 80.2341],
  Guindy: [13.01, 80.22],
  'Anna Nagar': [13.085, 80.2101],
  Adyar: [13.0067, 80.257],
  'Marina Beach': [13.05, 80.2824],
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

const densityColor = (density: string) =>
  density === 'high' ? 'red' : density === 'medium' ? 'orange' : 'green';

const densityRadius = (density: string) =>
  density === 'high' ? 24 : density === 'medium' ? 18 : 12;

const aqiLevel = (aqi: number) => {
  if (aqi <= 100) return { label: 'GOOD', color: 'text-green-400' };
  if (aqi <= 150) return { label: 'MODERATE', color: 'text-orange-400' };
  return { label: 'POOR', color: 'text-red-400' };
};

export function CityPlannerDashboard() {
  const googleMapsApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps-city-planner',
    googleMapsApiKey,
  });

  const [zones, setZones] = useState<Zone[]>([]);
  const [aqi, setAqi] = useState<AQI[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
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

    loadData();
  }, []);

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
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
              }}
            >
              {zones.map((zone) => {
                const coords = ZONE_COORDS[zone.name];
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
            </GoogleMap>
          )}
          {isClient && !isGoogleLoaded && (
            <div className="h-96 rounded-xl flex items-center justify-center text-sm text-white/70 bg-black/20">
              Loading Google Map...
            </div>
          )}
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
