import * as XLSX from 'xlsx';
import { DeliveryImportInput } from '../../services/deliveryService';

const requiredFields = [
  'commodity_name',
  'quantity',
  'pickup_lat',
  'pickup_lng',
  'drop_lat',
  'drop_lng',
] as const;

export async function parseFile(file: File): Promise<DeliveryImportInput[]> {
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

    const missingFields = requiredFields.filter(
      (field) => !normalizedHeaders.includes(field)
    );
    if (missingFields.length > 0) {
      throw new Error(`Missing required columns: ${missingFields.join(', ')}`);
    }

    const deliveries: DeliveryImportInput[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowObject: Record<string, any> = {};
      normalizedHeaders.forEach((header, index) => {
        rowObject[header] = row[index] !== undefined ? row[index] : '';
      });

      const commodity_name = rowObject.commodity_name?.toString().trim();
      if (!commodity_name) {
        throw new Error(`Row ${i + 2}: commodity_name is required and cannot be empty`);
      }

      const quantity = parseInt(rowObject.quantity, 10);
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Row ${i + 2}: quantity must be a positive integer (got "${rowObject.quantity}")`);
      }

      const pickup_lat = parseFloat(rowObject.pickup_lat);
      const pickup_lng = parseFloat(rowObject.pickup_lng);
      const drop_lat = parseFloat(rowObject.drop_lat);
      const drop_lng = parseFloat(rowObject.drop_lng);

      if (isNaN(pickup_lat)) {
        throw new Error(`Row ${i + 2}: pickup_lat must be a valid number (got "${rowObject.pickup_lat}")`);
      }
      if (isNaN(pickup_lng)) {
        throw new Error(`Row ${i + 2}: pickup_lng must be a valid number (got "${rowObject.pickup_lng}")`);
      }
      if (isNaN(drop_lat)) {
        throw new Error(`Row ${i + 2}: drop_lat must be a valid number (got "${rowObject.drop_lat}")`);
      }
      if (isNaN(drop_lng)) {
        throw new Error(`Row ${i + 2}: drop_lng must be a valid number (got "${rowObject.drop_lng}")`);
      }

      deliveries.push({
        commodity_name,
        quantity,
        pickup_lat,
        pickup_lng,
        drop_lat,
        drop_lng,
        status: 'pending',
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
