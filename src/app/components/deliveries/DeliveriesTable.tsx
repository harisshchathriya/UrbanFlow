import React from 'react';import { DeliveryRecord } from '../../../services/deliveryService';const statusColors = {
  assigned: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-rose-100 text-rose-800',
} as const;

type Status = keyof typeof statusColors;

const getStatusClass = (status?: string) => {
  const key = (status || 'assigned') as Status;
  return statusColors[key] || 'bg-gray-100 text-gray-800';
};

interface DeliveriesTableProps {
  deliveries: DeliveryRecord[];
}

const formatCoord = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : 'N/A';

const DeliveriesTable: React.FC<DeliveriesTableProps> = ({ deliveries }) => {
  return (
    <div className="overflow-x-auto bg-white shadow rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pickup</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dropoff</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Packages</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Weight</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pickup Coords</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dropoff Coords</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Driver</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.pickup_location}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.dropoff_location}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.packages}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.weight}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">{d.priority}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {formatCoord(d.from_lat)}, {formatCoord(d.from_lng)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {formatCoord(d.to_lat)}, {formatCoord(d.to_lng)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    getStatusClass(d.status)
                  }`}
                >
                  {(d.status || 'assigned').replace('_', ' ')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {d.driver_id ? d.driver_id.slice(0, 8) : 'Unassigned'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {d.vehicle_id ? d.vehicle_id.slice(0, 8) : 'Unassigned'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {new Date(d.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={11} className="px-6 py-4 text-center text-sm text-gray-500">
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
