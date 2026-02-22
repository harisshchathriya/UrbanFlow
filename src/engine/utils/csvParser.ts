import * as XLSX from 'xlsx';
import { DeliveryCsvRow, DeliveryPriority } from '../../services/deliveryService';const requiredFields = [
  'pickup_location',
  'dropoff_location',
  'from_lat',
  'from_lng',
  'to_lat',
  'to_lng',
  'packages',
] as const;

const HEADER_SYNONYMS: Record<string, string[]> = {
  pickup_location: ['pickup_location', 'pickup_address', 'pickup'],
  dropoff_location: ['dropoff_location', 'dropoff_address', 'dropoff', 'delivery_address'],
  from_lat: ['from_lat', 'pickup_lat', 'pickup_latitude'],
  from_lng: ['from_lng', 'pickup_lng', 'pickup_longitude'],
  to_lat: ['to_lat', 'drop_lat', 'drop_latitude', 'delivery_latitude'],
  to_lng: ['to_lng', 'drop_lng', 'drop_longitude', 'delivery_longitude'],
  packages: ['packages', 'package_count', 'quantity'],
  weight: ['weight', 'load_weight'],
  priority: ['priority'],
  driver_id: ['driver_id', 'assigned_driver_id'],
  vehicle_id: ['vehicle_id', 'assigned_vehicle_id'],
};

const getValue = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
};

const parseNumber = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return NaN;
};

export async function parseFile(file: File): Promise<DeliveryCsvRow[]> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (workbook.SheetNames.length === 0) {
      throw new Error('Excel file contains no sheets');
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
    });

    if (rows.length === 0) {
      throw new Error('File is empty');
    }

    const [headers, ...dataRows] = rows;

    if (!headers || headers.length === 0) {
      throw new Error('No header row found');
    }

    const normalizedHeaders = headers.map((h: string) =>
      String(h || '').trim().toLowerCase().replace(/\s+/g, '_')
    );

    const missingFields = requiredFields.filter((field) => {
      const synonyms = HEADER_SYNONYMS[field] || [field];
      return !synonyms.some((syn) => normalizedHeaders.includes(syn));
    });
    if (missingFields.length > 0) {
      throw new Error(`Missing required columns: ${missingFields.join(', ')}`);
    }

    const deliveries: DeliveryCsvRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowObject: Record<string, any> = {};
      normalizedHeaders.forEach((header, index) => {
        rowObject[header] = row[index] !== undefined ? row[index] : '';
      });

      const pickupLocation = String(getValue(rowObject, HEADER_SYNONYMS.pickup_location) ?? '').trim();
      if (!pickupLocation) {
        throw new Error(`Row ${i + 2}: pickup_location is required and cannot be empty`);
      }

      const dropoffLocation = String(getValue(rowObject, HEADER_SYNONYMS.dropoff_location) ?? '').trim();
      if (!dropoffLocation) {
        throw new Error(`Row ${i + 2}: dropoff_location is required and cannot be empty`);
      }

      const packagesRaw = getValue(rowObject, HEADER_SYNONYMS.packages);
      const packages = Number.parseInt(String(packagesRaw ?? ''), 10);
      if (Number.isNaN(packages) || packages <= 0) {
        throw new Error(`Row ${i + 2}: packages must be a positive integer (got "${packagesRaw}")`);
      }

      const fromLat = parseNumber(getValue(rowObject, HEADER_SYNONYMS.from_lat));
      const fromLng = parseNumber(getValue(rowObject, HEADER_SYNONYMS.from_lng));
      const toLat = parseNumber(getValue(rowObject, HEADER_SYNONYMS.to_lat));
      const toLng = parseNumber(getValue(rowObject, HEADER_SYNONYMS.to_lng));

      if (Number.isNaN(fromLat)) {
        throw new Error(`Row ${i + 2}: from_lat must be a valid number`);
      }
      if (Number.isNaN(fromLng)) {
        throw new Error(`Row ${i + 2}: from_lng must be a valid number`);
      }
      if (Number.isNaN(toLat)) {
        throw new Error(`Row ${i + 2}: to_lat must be a valid number`);
      }
      if (Number.isNaN(toLng)) {
        throw new Error(`Row ${i + 2}: to_lng must be a valid number`);
      }

      const priorityRaw = getValue(rowObject, HEADER_SYNONYMS.priority);
      const priority = priorityRaw ? String(priorityRaw).trim() : undefined;

      const weightRaw = getValue(rowObject, HEADER_SYNONYMS.weight);
      const weightParsed = weightRaw === undefined ? undefined : Number(weightRaw);

      deliveries.push({
        pickup_location: pickupLocation,
        dropoff_location: dropoffLocation,
        from_lat: fromLat,
        from_lng: fromLng,
        to_lat: toLat,
        to_lng: toLng,
        packages,
        weight: Number.isFinite(weightParsed) ? weightParsed : undefined,
        priority: priority ? (priority as DeliveryPriority) : undefined,
        driver_id: getValue(rowObject, HEADER_SYNONYMS.driver_id)?.toString().trim(),
        vehicle_id: getValue(rowObject, HEADER_SYNONYMS.vehicle_id)?.toString().trim() || undefined,
      });
    }

    if (deliveries.length === 0) {
      throw new Error('No valid data rows found');
    }

    return deliveries;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Import failed: ${error.message}`);
    }
    throw new Error('Unknown error during file parsing');
  }
}
