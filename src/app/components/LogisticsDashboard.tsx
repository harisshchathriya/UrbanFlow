import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { GoogleMap, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { DashboardHeader } from './DashboardHeader';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { CO2Dashboard } from './CO2Dashboard';
import { LoadConsolidationDashboard } from './LoadConsolidationDashboard';
import { supabase } from '../../services/supabaseClient';
import { hasVerifiedRole } from '../auth/fallbackAuth';
import { AdvancedMarker } from './maps/AdvancedMarker';
import { GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY, MAP_LIBRARIES } from './maps/googleMapsConfig';
import { AlertTriangle, ArrowRight, Clock, Package, Route, Truck, Users } from 'lucide-react';

const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || '';
const ORS_TIMEOUT_MS = 8000;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
};

const fetchRoadRoute = async (start: [number, number], end: [number, number]) => {
  if (!ORS_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ORS_TIMEOUT_MS);
    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}&format=geojson`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Failed to fetch route');
    const data = await response.json();
    if (!data?.features?.length || !data.features[0]?.geometry?.coordinates?.length) return null;
    const coordinates = data.features[0].geometry.coordinates.map(
      (coord: number[]) => [coord[1], coord[0]] as [number, number]
    );
    const segment = data.features[0]?.properties?.segments?.[0];
    const distance = Number(segment?.distance || 0) / 1000;
    const duration = Number(segment?.duration || 0) / 60;
    return {
      coordinates,
      distance: Math.round(distance * 10) / 10,
      duration: Math.max(1, Math.round(duration)),
      source: 'road' as const,
    };
  } catch {
    return null;
  }
};

const buildFallbackRoute = (start: [number, number], end: [number, number]) => {
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]) * 111;
  return {
    coordinates: [start, end],
    distance: Math.round(distance * 10) / 10,
    duration: Math.max(1, Math.round(distance * 3)),
    source: 'fallback' as const,
  };
};

// ...CONTENT REDACTED FOR BREVITY...