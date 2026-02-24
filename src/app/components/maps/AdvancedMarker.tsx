import { useEffect } from 'react';import { useGoogleMap } from '@react-google-maps/api';type AdvancedMarkerProps = {
  position: google.maps.LatLngLiteral;
  title?: string;
  label?: string;
  color?: string;
  size?: number;
  zIndex?: number;
  enabled?: boolean;
  pulse?: boolean;
  onClick?: () => void;
};

const injectPulseStyle = () => {
  if (document.getElementById('urbanflow-pulse-style')) return;
  const style = document.createElement('style');
  style.id = 'urbanflow-pulse-style';
  style.textContent = `@keyframes urbanflow-pulse {0%{transform:scale(1);}50%{transform:scale(1.2);}100%{transform:scale(1);}}`;
  document.head.appendChild(style);
};

const buildContent = (label?: string, color?: string, size?: number, pulse?: boolean) => {
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
  if (pulse) {
    el.style.animation = 'urbanflow-pulse 1.2s ease-in-out infinite';
  }
  return el;
};

export function AdvancedMarker({ position, title, label, color, size, zIndex, enabled = true, pulse = false, onClick }: AdvancedMarkerProps) {
  const map = useGoogleMap();

  useEffect(() => {
    if (!map || !enabled) return;
    if (pulse) injectPulseStyle();
    const markerLib = (google.maps as any)?.marker;
    const AdvancedMarkerElement = markerLib?.AdvancedMarkerElement;
    if (!AdvancedMarkerElement) return;

    const content = buildContent(label, color, size, pulse);
    const marker = new AdvancedMarkerElement({
      map,
      position,
      title,
      content,
      zIndex,
    });

    const handleClick = () => {
      onClick?.();
    };
    const listener = marker.addListener('click', handleClick);

    return () => {
      listener?.remove();
      marker.map = null;
    };
  }, [map, position, title, label, color, size, zIndex, enabled, pulse, onClick]);

  return null;
}
