import React, { useEffect, useState } from 'react';
import { fetchDeliveryImports, DeliveryImport } from '../services/deliveryService';
import CSVImportButton from './components/deliveries/CSVImportButton';
import DeliveriesTable from './components/deliveries/DeliveriesTable';
import { supabase } from '../services/supabaseClient';

const OperatorDeliveriesPage: React.FC = () => {
  const [deliveries, setDeliveries] = useState<DeliveryImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadDeliveries = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeliveryImports();
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
    const channel = supabase
      .channel('operator-deliveries-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_imports' }, () => {
        void loadDeliveries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = deliveries.filter(d =>
    (d.commodity_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Deliveries</h1>
        <CSVImportButton onSuccess={loadDeliveries} />
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by commodity..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border rounded w-full md:w-64"
        />
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
