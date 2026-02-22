import { useEffect } from 'react';import { useGoogleMap } from '@react-google-maps/api';type AdvancedMarkerProps = {
  position: google.maps.LatLngLiteral;
  title?: string;
  label?: string;
  color?: string;
  size?: number;
  zIndex?: number;
  enabled?: boolean;
};

const buildContent = (label?: string, color?: string, size?: number) => {
  const dotSize = Math.max(10, size ?? 14);
  const el = document.createElement('div');
  el.style.width = `${dotSize}px`;
  el.style.height = `${dotSize}px`;
  el.style.background = color || '#22d3ee';
  el.style.border = '2px solid #ffffff';
  el.style.borderRadius = '999px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.color = '#ffffff';
  el.style.fontSize = `${Math.max(10, Math.round(dotSize * 0.5))}px`;
  el.style.fontWeight = '700';
  el.style.boxShadow = '0 0 8px rgba(0,0,0,0.25)';
  if (label) {
    el.textContent = label;
  }
  return el;
};

export function AdvancedMarker({ position, title, label, color, size, zIndex, enabled = true }: AdvancedMarkerProps) {
  const map = useGoogleMap();

  useEffect(() => {
    if (!map || !enabled) return;
    const markerLib = (google.maps as any)?.marker;
    const AdvancedMarkerElement = markerLib?.AdvancedMarkerElement;
    if (!AdvancedMarkerElement) return;

    const content = buildContent(label, color, size);
    const marker = new AdvancedMarkerElement({
      map,
      position,
      title,
      content,
      zIndex,
    });

    return () => {
      marker.map = null;
    };
  }, [map, position, title, label, color, size, zIndex, enabled]);

  return null;
}
