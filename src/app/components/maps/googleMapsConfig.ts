import type { Library } from '@react-google-maps/api';

export const MAP_LIBRARIES: Library[] = ['marker'];
export const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '';
export const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBthAa_IcLPDqnl8mZtk7XfcQRtFbDXl_E';
