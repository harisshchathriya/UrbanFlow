import React, { useEffect, useState } from 'react';
import { fetchDeliveries, DeliveryRecord } from '../services/deliveryService';import CSVImportButton from './components/deliveries/CSVImportButton';import DeliveriesTable from './components/deliveries/DeliveriesTable';import { supabase } from '../services/supabaseClient';type DriverOption = {
  id: string;
  name: string;
};

type VehicleOption = {
  id: string;
  label: string;
};

const OperatorDeliveriesPage: React.FC = () => {
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');

  const loadDeliveries = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeliveries();
      setDeliveries(data);
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeliveries();
  }, []);

  useEffect(() => {
    const loadMeta = async () => {
      const [driversRes, vehiclesRes] = await Promise.all([
        supabase.from('drivers').select('id, name').order('name', { ascending: true }),
        supabase.from('vehicles').select('id, driver_name').order('driver_name', { ascending: true }),
      ]);

      if (!driversRes.error) {
        setDrivers(
          (driversRes.data || []).map((d) => ({
            id: d.id,
            name: d.name ?? 'Unknown',
          }))
        );
      }

      if (!vehiclesRes.error) {
        setVehicles(
          (vehiclesRes.data || []).map((v) => ({
            id: v.id,
            label: v.driver_name ? `${v.driver_name} (${v.id.slice(0, 8)})` : v.id,
          }))
        );
      }
    };

    void loadMeta();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('operator-deliveries-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => {
        void loadDeliveries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = deliveries.filter(d =>
    `${d.pickup_location} ${d.dropoff_location}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Deliveries</h1>
        <CSVImportButton
          onSuccess={loadDeliveries}
          driverId={selectedDriverId || undefined}
          vehicleId={selectedVehicleId || undefined}
        />
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border rounded w-full md:w-64"
        />
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="block text-sm text-gray-700">
          Driver
          <select
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="">Select a driver</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name} ({driver.id.slice(0, 8)})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-700">
          Vehicle (optional)
          <select
            value={selectedVehicleId}
            onChange={(e) => setSelectedVehicleId(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="">Unassigned</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {lastUpdated && !loading && !error && (
        <p className="text-xs text-gray-500 mb-3">
          Last synced: {new Date(lastUpdated).toLocaleTimeString()}
        </p>
      )}

      {loading ? (
        <div className="text-center py-10">Loading deliveries...</div>
      ) : error ? (
        <div className="text-center py-10 text-red-600">{error}</div>
      ) : (
        <DeliveriesTable deliveries={filtered} />
      )}
    </div>
  );
};

export default OperatorDeliveriesPage;
