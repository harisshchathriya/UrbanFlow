import React from 'react';
import { DeliveryImport } from '../../../services/deliveryService';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-rose-100 text-rose-800',
} as const;

type Status = keyof typeof statusColors;

const getStatusClass = (status?: string) => {
  const key = (status || 'pending') as Status;
  return statusColors[key] || 'bg-gray-100 text-gray-800';
};

interface DeliveriesTableProps {
  deliveries: DeliveryImport[];
}

const DeliveriesTable: React.FC<DeliveriesTableProps> = ({ deliveries }) => {
  return (
    <div className="overflow-x-auto bg-white shadow rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commodity</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pickup</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Drop</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.commodity_name}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.quantity}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {d.pickup_lat.toFixed(4)}, {d.pickup_lng.toFixed(4)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {d.drop_lat.toFixed(4)}, {d.drop_lng.toFixed(4)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    getStatusClass(d.status)
                  }`}
                >
                  {(d.status || 'pending').replace('_', ' ')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {new Date(d.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                No deliveries found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DeliveriesTable;
