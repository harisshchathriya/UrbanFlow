import { useMemo, useRef, useState } from 'react';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { parseFile } from '../../engine/utils/csvParser';
import { CircleF, GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Package,
  Route,
  Truck,
  Upload,
  Users,
} from 'lucide-react';

type Driver = {
  id: string;
  name: string;
  status: 'idle' | 'on_delivery' | 'break';
  lat: number;
  lng: number;
  vehicleId: string;
};

type Delivery = {
  id: string;
  commodity_name: string;
  quantity: number;
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  status: 'pending' | 'assigned' | 'in_transit' | 'delivered';
  eta: string;
};

type AlertItem = {
  id: string;
  severity: 'warning' | 'danger' | 'info';
  message: string;
};

const mockDrivers: Driver[] = [
  { id: 'DRV-101', name: 'Aarav Singh', status: 'on_delivery', lat: 12.9721, lng: 77.5949, vehicleId: 'VH-101' },
  { id: 'DRV-102', name: 'Meera Rao', status: 'idle', lat: 12.9618, lng: 77.6031, vehicleId: 'VH-102' },
  { id: 'DRV-103', name: 'Ishaan Patel', status: 'break', lat: 12.9875, lng: 77.5722, vehicleId: 'VH-103' },
];

const mockDeliveries: Delivery[] = [
  {
    id: 'DLV-9001',
    commodity_name: 'Cold-chain Pharma',
    quantity: 24,
    pickup_lat: 12.9651,
    pickup_lng: 77.6052,
    drop_lat: 12.9513,
    drop_lng: 77.6219,
    status: 'in_transit',
    eta: '14:20',
  },
  {
    id: 'DLV-9002',
    commodity_name: 'Retail Cartons',
    quantity: 56,
    pickup_lat: 12.9781,
    pickup_lng: 77.5884,
    drop_lat: 12.9965,
    drop_lng: 77.6121,
    status: 'assigned',
    eta: '15:05',
  },
  {
    id: 'DLV-9003',
    commodity_name: 'Electronics',
    quantity: 12,
    pickup_lat: 12.9495,
    pickup_lng: 77.5901,
    drop_lat: 12.9364,
    drop_lng: 77.6109,
    status: 'pending',
    eta: '16:10',
  },
];

const statusBadge: Record<Delivery['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-emerald-100 text-emerald-800',
};

export function MockLogisticsOperatorDashboard() {
  const googleMapsApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    id: 'urbanflow-google-maps-mock-logistics-operator',
    googleMapsApiKey,
  });

  const [drivers] = useState<Driver[]>(mockDrivers);
  const [deliveries, setDeliveries] = useState<Delivery[]>(mockDeliveries);
  const [alerts, setAlerts] = useState<AlertItem[]>([
    { id: 'A-1', severity: 'danger', message: 'Driver DRV-101 deviated 1.3 km from planned route.' },
    { id: 'A-2', severity: 'warning', message: 'Delivery DLV-9002 may miss ETA by 8 minutes.' },
    { id: 'A-3', severity: 'info', message: 'CSV import ready. Upload new batches for dispatch.' },
  ]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDeliveries = useMemo(
    () => deliveries.filter((d) => d.status === 'assigned' || d.status === 'in_transit').length,
    [deliveries]
  );

  const deliveredCount = useMemo(
    () => deliveries.filter((d) => d.status === 'delivered').length,
    [deliveries]
  );

  const pendingCount = useMemo(
    () => deliveries.filter((d) => d.status === 'pending').length,
    [deliveries]
  );

  const activeDrivers = useMemo(
    () => drivers.filter((d) => d.status === 'on_delivery').length,
    [drivers]
  );

  const smartRouteSuggestions = useMemo(() => {
    const idleDrivers = drivers.filter((d) => d.status === 'idle');
    const pendingDeliveries = deliveries.filter((d) => d.status === 'pending');
    return pendingDeliveries.slice(0, 3).map((delivery, index) => ({
      id: `${delivery.id}-${index}`,
      deliveryId: delivery.id,
      assignedDriver: idleDrivers[index % Math.max(idleDrivers.length, 1)]?.name || 'Queue Hold',
      reason: idleDrivers.length > 0 ? 'Nearest idle driver match' : 'No idle driver available',
    }));
  }, [drivers, deliveries]);

  const handleImportClick = () => {
    if (!importing) fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);

    try {
      const parsed = await parseFile(file);
      const now = Date.now();
      const importedRows: Delivery[] = parsed.map((row, index) => ({
        id: `DLV-MOCK-${now + index}`,
        commodity_name: row.commodity_name,
        quantity: row.quantity,
        pickup_lat: row.pickup_lat,
        pickup_lng: row.pickup_lng,
        drop_lat: row.drop_lat,
        drop_lng: row.drop_lng,
        status: row.status === 'pending' ? 'pending' : 'assigned',
        eta: 'TBD',
      }));

      setDeliveries((prev) => [...importedRows, ...prev]);
      setAlerts((prev) => [
        {
          id: `A-IMPORT-${now}`,
          severity: 'info',
          message: `Imported ${importedRows.length} mock delivery rows from ${file.name}.`,
        },
        ...prev.slice(0, 4),
      ]);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen urbanflow-gradient p-6">
      <div className="max-w-7xl mx-auto">
        <DashboardHeader
          title="Logistics Operator Dashboard"
          subtitle=""
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <KPICard icon={Package} label="Total Deliveries" value={deliveries.length} />
          <KPICard icon={Clock} label="Pending Deliveries" value={pendingCount} />
          <KPICard icon={Truck} label="Active Deliveries" value={activeDeliveries} />
          <KPICard icon={Users} label="Active Drivers" value={activeDrivers} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <GlassCard className="lg:col-span-2">
            <h2 className="text-lg text-primary-urban mb-3">Driver & Delivery Map</h2>
            <div className="h-80 rounded-xl overflow-hidden">
              {isGoogleLoaded ? (
                <GoogleMap
                  center={{ lat: 12.9716, lng: 77.5946 }}
                  zoom={12}
                  mapContainerClassName="h-full w-full"
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
                      title={`${driver.name} | ${driver.id} | ${driver.vehicleId} | Status: ${driver.status}`}
                    />
                  ))}
                  {deliveries.map((delivery) => (
                    <CircleF
                      key={`drop-${delivery.id}`}
                      center={{ lat: delivery.drop_lat, lng: delivery.drop_lng }}
                      radius={200}
                      options={{
                        strokeColor: delivery.status === 'delivered' ? '#16a34a' : '#2563eb',
                        fillColor: delivery.status === 'delivered' ? '#16a34a' : '#2563eb',
                        fillOpacity: 0.35,
                      }}
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
            <h2 className="text-lg text-primary-urban mb-3">Alerts</h2>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-xl text-sm ${
                    alert.severity === 'danger'
                      ? 'bg-red-500/20 text-red-200'
                      : alert.severity === 'warning'
                      ? 'bg-yellow-500/20 text-yellow-100'
                      : 'bg-cyan-500/20 text-cyan-100'
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
            <h2 className="text-lg text-primary-urban mb-3">Driver Monitoring</h2>
            <div className="space-y-3">
              {drivers.map((driver) => (
                <div key={driver.id} className="p-3 rounded-xl border border-white/10 bg-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-primary-urban">{driver.name}</p>
                    <p className="text-xs text-muted-urban">{driver.id} • {driver.vehicleId}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-white/10 capitalize">{driver.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="text-lg text-primary-urban mb-3">SmartRoute+ Suggestions</h2>
            <div className="space-y-3">
              {smartRouteSuggestions.map((s) => (
                <div key={s.id} className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                  <p className="text-primary-urban flex items-center gap-2">
                    <Route className="w-4 h-4" />
                    Recommend {s.assignedDriver} for {s.deliveryId}
                  </p>
                  <p className="text-xs text-muted-urban mt-1">{s.reason}</p>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg text-primary-urban">Delivery Management + CSV Import</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleImportClick}
                disabled={importing}
                className="glass-button px-4 py-2 rounded-lg text-white flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {importing ? 'Importing...' : 'Import CSV/XLSX'}
              </button>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
            </div>
          </div>

          {importError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/20 text-red-100 text-sm">{importError}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-urban border-b border-white/10">
                  <th className="py-2">Delivery</th>
                  <th className="py-2">Commodity</th>
                  <th className="py-2">Qty</th>
                  <th className="py-2">ETA</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-b border-white/5">
                    <td className="py-2 text-primary-urban">{delivery.id}</td>
                    <td className="py-2">{delivery.commodity_name}</td>
                    <td className="py-2">{delivery.quantity}</td>
                    <td className="py-2">{delivery.eta}</td>
                    <td className="py-2">
                      <span className={`px-2 py-1 text-xs rounded-full ${statusBadge[delivery.status]}`}>
                        {delivery.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-muted-urban text-xs mb-1">Delivered</p>
              <p className="text-primary-urban text-xl flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-300" /> {deliveredCount}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-muted-urban text-xs mb-1">Pending</p>
              <p className="text-primary-urban text-xl flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-300" /> {pendingCount}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-muted-urban text-xs mb-1">Open Alerts</p>
              <p className="text-primary-urban text-xl flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-300" /> {alerts.length}
              </p>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
