import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { hasVerifiedRole } from '../auth/fallbackAuth';

export function DashboardRouter() {
  const { role } = useParams();
  const location = useLocation();
  const effectiveRole =
    role || (location.pathname === '/dashboard/vehicle-driver' ? 'vehicle-driver' : undefined);
  const allowGuest = import.meta.env.VITE_ALLOW_GUEST_DASHBOARD === 'true' || import.meta.env.DEV;
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(false);

  useEffect(() => {
    const resolveVehicleId = async () => {
      if (effectiveRole !== 'vehicle-driver') return;
      setLoadingVehicle(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;
        if (!userId) {
          if (hasVerifiedRole('vehicle-driver') || allowGuest) {
            const { data: driverData } = await supabase
              .from('drivers')
              .select('id')
              .order('created_at', { ascending: false })
              .limit(1);
            setVehicleId(driverData?.[0]?.id ? String(driverData[0].id) : 'guest-driver');
            return;
          }
          setVehicleId(null);
          return;
        }

        setVehicleId(String(userId));
      } finally {
        setLoadingVehicle(false);
      }
    };

    void resolveVehicleId();
  }, [effectiveRole, allowGuest]);

  switch (effectiveRole) {
    case 'logistics-operator':
      return <Navigate to="/dashboard/logistics-operator" replace />;
    case 'vehicle-driver':
      if (loadingVehicle) return null;
      if (!vehicleId) {
        if (hasVerifiedRole('vehicle-driver') || allowGuest) {
          return <Navigate to="/dashboard/vehicle-driver/guest-driver" replace />;
        }
        return <Navigate to="/login/vehicle-driver" replace />;
      }
      return <Navigate to={`/dashboard/vehicle-driver/${vehicleId}`} replace />;
    case 'city-planner':
      return <Navigate to="/dashboard/city-planner" replace />;
    default:
      return <Navigate to="/role-selection" replace />;
  }
}

