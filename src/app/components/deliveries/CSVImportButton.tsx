import React, { useRef, useState } from "react";
import { parseFile } from "../../../engine/utils/csvParser";
import { upsertDeliveryImports } from "../../../services/deliveryService";

interface CSVImportButtonProps {
  onSuccess: () => void;
}

const CSVImportButton: React.FC<CSVImportButtonProps> = ({ onSuccess }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = () => {
    if (!loading) {
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

      const deliveries = await parseFile(file);

      if (!deliveries || deliveries.length === 0) {
        throw new Error("No valid delivery records found.");
      }

      await upsertDeliveryImports(deliveries);
      setMessage(`Imported ${deliveries.length} delivery record(s).`);

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
        disabled={loading}
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
