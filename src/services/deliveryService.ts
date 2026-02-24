import { supabase } from './supabaseClient';export type DeliveryStatus =
  | 'assigned'
  | 'accepted'
  | 'in_transit'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type DeliveryPriority = 'High' | 'Medium' | 'Low';

export interface DeliveryRecord {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  packages: number;
  weight: number;
  priority: DeliveryPriority;
  status: DeliveryStatus;
  driver_id: string | null;
  vehicle_id: string | null;
  created_at: string;
}

export type DeliveryCsvRow = {
  pickup_location: string;
  dropoff_location: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  packages: number;
  weight?: number;
  priority?: DeliveryPriority;
  driver_id?: string;
  vehicle_id?: string | null;
};

export type DeliveryInsertInput = Omit<DeliveryRecord, 'id' | 'created_at'> & {
  created_at?: string;
};

// Backward-compatible alias for UI imports
// Flexible import shape for CSV/parser variants
export type DeliveryImportInput = DeliveryInsertInput & {
  commodity_name?: string;
  quantity?: number;
  pickup_lat?: number;
  pickup_lng?: number;
  drop_lat?: number;
  drop_lng?: number;
};

export const fetchDeliveries = async (): Promise<DeliveryRecord[]> => {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data || []) as DeliveryRow[]).map(normalizeDelivery);
};

export const insertDeliveries = async (rows: DeliveryInsertInput[]): Promise<void> => {
  const { error } = await supabase
    .from('deliveries')
    .insert(rows);

  if (error) throw new Error(error.message);
};

export const deliveryService = {
  insertDeliveries,
};

export default deliveryService;

type DeliveryRow = Record<string, unknown>;

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
};

const parseStatus = (value: unknown): DeliveryStatus => {
  const status = String(value || '').toLowerCase();
  if (
    status === 'assigned' ||
    status === 'accepted' ||
    status === 'in_transit' ||
    status === 'completed' ||
    status === 'rejected' ||
    status === 'cancelled'
  ) {
    return status;
  }
  if (status === 'pending') return 'assigned';
  if (status === 'delivered') return 'completed';
  if (status === 'declined') return 'rejected';
  return 'assigned';
};

const normalizeDelivery = (row: DeliveryRow): DeliveryRecord => ({
  id: String(row.id ?? row.delivery_id ?? ''),
  pickup_location: String(row.pickup_location ?? row.pickup_address ?? ''),
  dropoff_location: String(row.dropoff_location ?? row.dropoff_address ?? ''),
  from_lat: parseNumber(row.from_lat ?? row.pickup_lat ?? row.pickup_latitude),
  from_lng: parseNumber(row.from_lng ?? row.pickup_lng ?? row.pickup_longitude),
  to_lat: parseNumber(row.to_lat ?? row.drop_lat ?? row.delivery_latitude ?? row.drop_latitude),
  to_lng: parseNumber(row.to_lng ?? row.drop_lng ?? row.delivery_longitude ?? row.drop_longitude),
  packages: parseNumber(row.packages ?? row.quantity ?? row.package_count),
  weight: parseNumber(row.weight ?? row.load_weight),
  priority: (row.priority as DeliveryPriority) || 'Medium',
  status: parseStatus(row.status),
  driver_id: row.driver_id ? String(row.driver_id) : null,
  vehicle_id: row.vehicle_id ? String(row.vehicle_id) : null,
  created_at: String(row.created_at ?? ''),
});

const getTodayDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodaysDeliveries = async (driverId: string): Promise<DeliveryRecord[]> => {
  const today = getTodayDate();
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('driver_id', driverId)
    .gte('created_at', `${today}T00:00:00.000Z`)
    .in('status', ['assigned', 'accepted', 'in_transit'])
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch today's deliveries: ${error.message}`);
  }

  return ((data || []) as DeliveryRow[]).map(normalizeDelivery);
};

export const getDeliveryById = async (deliveryId: string): Promise<DeliveryRecord | null> => {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
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
    .eq('id', deliveryId);

  if (error) {
    throw new Error(`Failed to update delivery ${deliveryId} to ${status}: ${error.message}`);
  }

  return true;
};
