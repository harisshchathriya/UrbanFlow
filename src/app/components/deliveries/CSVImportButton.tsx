import React, { useRef, useState } from "react";
import { parseFile } from '../../../engine/utils/csvParser';import { DeliveryInsertInput, insertDeliveries } from '../../../services/deliveryService';interface CSVImportButtonProps {
  onSuccess: () => void;
  driverId?: string | null;
  vehicleId?: string | null;
}

const CSVImportButton: React.FC<CSVImportButtonProps> = ({ onSuccess, driverId, vehicleId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = () => {
    if (!loading && driverId) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const allowedMimeTypes = [
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ];
      const fileName = file.name.toLowerCase();
      const allowedExtension = fileName.endsWith('.csv') || fileName.endsWith('.xlsx');

      if (!allowedMimeTypes.includes(file.type) && !allowedExtension) {
        throw new Error("Invalid file type. Upload CSV or XLSX.");
      }

      const parsedRows = await parseFile(file);

      if (!parsedRows || parsedRows.length === 0) {
        throw new Error("No valid delivery records found.");
      }

      const nowIso = new Date().toISOString();
      const payloads: DeliveryInsertInput[] = parsedRows.map((row) => {
        const resolvedDriverId = row.driver_id || driverId;
        if (!resolvedDriverId) {
          throw new Error("Driver ID is required for every imported row.");
        }
        if (row.driver_id && driverId && row.driver_id !== driverId) {
          throw new Error("Driver ID in CSV must match the selected driver.");
        }
        return {
          pickup_location: row.pickup_location,
          dropoff_location: row.dropoff_location,
          from_lat: row.from_lat,
          from_lng: row.from_lng,
          to_lat: row.to_lat,
          to_lng: row.to_lng,
          packages: row.packages,
          weight: row.weight ?? 0,
          priority: row.priority || "Medium",
          status: "assigned",
          driver_id: resolvedDriverId,
          vehicle_id: row.vehicle_id || vehicleId || null,
          created_at: nowIso,
        };
      });

      await insertDeliveries(payloads);
      setMessage(`Imported ${payloads.length} delivery record(s).`);

      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Import failed");
    } finally {
      setLoading(false);

      // Reset input so same file can be uploaded again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading || !driverId}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
      >
        {loading ? "Importing..." : "Import CSV"}
      </button>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".csv,.xlsx"
        className="hidden"
      />

      {!driverId && (
        <p className="text-amber-700 text-sm mt-2">
          Select a driver before importing.
        </p>
      )}
      {error && (
        <p className="text-red-600 text-sm mt-2">
          {error}
        </p>
      )}
      {message && (
        <p className="text-green-700 text-sm mt-2">
          {message}
        </p>
      )}
    </div>
  );
};

export default CSVImportButton;
