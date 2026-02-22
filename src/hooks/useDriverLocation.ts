import { useEffect, useState } from 'react';export interface DriverLocation {
  latitude: number;
  longitude: number;
}

interface UseDriverLocationResult {
  location: DriverLocation | null;
  error: string | null;
}

export const useDriverLocation = (): UseDriverLocationResult => {
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setError(null);
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError('Location permission denied.');
          return;
        }
        if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setError('Location unavailable.');
          return;
        }
        if (geoError.code === geoError.TIMEOUT) {
          setError('Location request timed out.');
          return;
        }
        setError('Failed to read location.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 2000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return { location, error };
};
