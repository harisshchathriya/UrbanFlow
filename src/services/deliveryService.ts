import { supabase } from './supabaseClient';

export type DeliveryImportStatus =
  | 'pending'
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export interface DeliveryImport {
  id: string;
  commodity_name: string;
  quantity: number;
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  status: DeliveryImportStatus;
  created_at: string;
}

export type DeliveryImportInput = Omit<DeliveryImport, 'id' | 'created_at' | 'status'> & {
  status?: DeliveryImportStatus;
};

export const fetchDeliveryImports = async (): Promise<DeliveryImport[]> => {
  const { data, error } = await supabase
    .from('delivery_imports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};

export const upsertDeliveryImports = async (imports: DeliveryImportInput[]): Promise<void> => {
  const { error } = await supabase
    .from('delivery_imports')
    .insert(imports);

  if (error) throw new Error(error.message);
};

export type DeliveryStatus = 'assigned' | 'accepted' | 'declined' | 'completed';

export interface Delivery {
  delivery_id: string;
  driver_id: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_lat: number;
  destination_lng: number;
  address: string;
  load_details: string;
  status: DeliveryStatus;
  delivery_date: string;
}

type DeliveryRow = {
  delivery_id: unknown;
  driver_id: unknown;
  pickup_lat: unknown;
  pickup_lng: unknown;
  destination_lat: unknown;
  destination_lng: unknown;
  address: unknown;
  load_details: unknown;
  status: unknown;
  delivery_date: unknown;
};

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
};

const parseStatus = (value: unknown): DeliveryStatus => {
  const status = String(value || '').toLowerCase();
  if (status === 'accepted' || status === 'declined' || status === 'completed') {
    return status;
  }
  return 'assigned';
};

const normalizeDelivery = (row: DeliveryRow): Delivery => ({
  delivery_id: String(row.delivery_id ?? ''),
  driver_id: String(row.driver_id ?? ''),
  pickup_lat: parseNumber(row.pickup_lat),
  pickup_lng: parseNumber(row.pickup_lng),
  destination_lat: parseNumber(row.destination_lat),
  destination_lng: parseNumber(row.destination_lng),
  address: String(row.address ?? ''),
  load_details: String(row.load_details ?? ''),
  status: parseStatus(row.status),
  delivery_date: String(row.delivery_date ?? ''),
});

const getTodayDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodaysDeliveries = async (driverId: string): Promise<Delivery[]> => {
  const today = getTodayDate();
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('driver_id', driverId)
    .eq('delivery_date', today)
    .order('delivery_id', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch today's deliveries: ${error.message}`);
  }

  return ((data || []) as DeliveryRow[]).map(normalizeDelivery);
};

export const getDeliveryById = async (deliveryId: string): Promise<Delivery | null> => {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('delivery_id', deliveryId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch delivery ${deliveryId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return normalizeDelivery(data as DeliveryRow);
};

export const updateDeliveryStatus = async (
  deliveryId: string,
  status: DeliveryStatus
): Promise<boolean> => {
  const { error } = await supabase
    .from('deliveries')
    .update({ status })
    .eq('delivery_id', deliveryId);

  if (error) {
    throw new Error(`Failed to update delivery ${deliveryId} to ${status}: ${error.message}`);
  }

  return true;
};
